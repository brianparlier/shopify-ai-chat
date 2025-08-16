// api/chat.js
import fs from 'fs';
import path from 'path';

// --- Allowed storefront origins ---
const ALLOWED_ORIGINS = new Set([
  'https://thephonographshop.myshopify.com',
  'https://thephonographshop.com',
  'https://www.thephonographshop.com',
]);

// --- Optional: block emails entirely from responses ---
const BLOCK_EMAIL = true;

// ---------------- CSV LOADER & PARSER ----------------
let CATALOG = null; // will hold an array of product records

function loadProductsCsvOnce() {
  if (CATALOG) return CATALOG;
  try {
    const csvPath = path.join(process.cwd(), 'data', 'products.csv');
    const raw = fs.readFileSync(csvPath, 'utf8');
    const rows = csvToRows(raw);
    const headers = rows.shift() || [];

    // Normalize column names we care about
    // Shopify exports commonly include these:
    const H = mapHeaders(headers, [
      'Handle',
      'Title',
      'Vendor',
      'Tags',
      'Body (HTML)',
      'Variant SKU',
      'Variant Price',
      'Option1 Name',
      'Option1 Value',
      'Option2 Name',
      'Option2 Value',
      'Option3 Name',
      'Option3 Value',
    ]);

    // Group by Handle to aggregate variants/SKUs
    const byHandle = new Map();
    for (const r of rows) {
      if (!r.length) continue;
      const rec = (idx) => (idx >= 0 && idx < r.length ? r[idx] : '');
      const handle = rec(H['Handle']);
      if (!handle) continue;

      const title = rec(H['Title']);
      const vendor = rec(H['Vendor']);
      const tags = rec(H['Tags']);
      const body = rec(H['Body (HTML)']);

      const sku = rec(H['Variant SKU']);
      const price = rec(H['Variant Price']);
      const opt1n = rec(H['Option1 Name']);
      const opt1v = rec(H['Option1 Value']);
      const opt2n = rec(H['Option2 Name']);
      const opt2v = rec(H['Option2 Value']);
      const opt3n = rec(H['Option3 Name']);
      const opt3v = rec(H['Option3 Value']);

      if (!byHandle.has(handle)) {
        byHandle.set(handle, {
          handle,
          title,
          vendor,
          tags,
          body,
          variants: [],
        });
      }
      const p = byHandle.get(handle);
      p.variants.push({
        sku,
        price,
        options: [
          opt1n && opt1v ? `${opt1n}: ${opt1v}` : '',
          opt2n && opt2v ? `${opt2n}: ${opt2v}` : '',
          opt3n && opt3v ? `${opt3n}: ${opt3v}` : '',
        ].filter(Boolean),
      });
    }

    CATALOG = Array.from(byHandle.values());
  } catch (e) {
    console.warn('No products CSV found or parse error:', e.message);
    CATALOG = [];
  }
  return CATALOG;
}

// Minimal CSV → rows parser that respects quotes and escaped quotes
function csvToRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += c;
        i++;
        continue;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ',') {
        row.push(field);
        field = '';
        i++;
        continue;
      }
      if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }
      if (c === '\r') {
        // handle CRLF
        i++;
        continue;
      }
      field += c;
      i++;
    }
  }
  // last field
  row.push(field);
  rows.push(row);
  return rows;
}

function mapHeaders(headers, wanted) {
  // returns a map: ColumnName -> index (or -1 if not found)
  const idx = {};
  for (const name of wanted) {
    const found = headers.findIndex(
      (h) => h.trim().toLowerCase() === name.trim().toLowerCase()
    );
    idx[name] = found;
  }
  return idx;
}

// Simple relevance: score by occurrences of prompt tokens in title/vendor/tags/body/sku
function findRelevantProducts(prompt, max = 5) {
  if (!prompt || !CATALOG?.length) return [];
  const q = prompt.toLowerCase();
  const tokens = Array.from(
    new Set(q.split(/[^a-z0-9]+/).filter((t) => t.length >= 2))
  );

  const scored = CATALOG.map((p) => {
    const hay = [
      p.title,
      p.vendor,
      p.tags,
      p.body,
      ...(p.variants || []).map((v) => v.sku || ''),
    ]
      .join(' | ')
      .toLowerCase();

    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score++;
    }
    return { p, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ p }) => p);
}

function formatProductsForContext(products) {
  if (!products.length) return '';
  const lines = [];

  for (const p of products) {
    const skus = (p.variants || [])
      .map((v) => v.sku)
      .filter(Boolean)
      .slice(0, 6)
      .join(', ');
    const price = (p.variants || [])
      .map((v) => v.price)
      .filter(Boolean)
      .slice(0, 1)
      .join('');
    const optsPreview = (p.variants || [])
      .map((v) => v.options?.join(' / '))
      .filter(Boolean)
      .slice(0, 2)
      .join(' | ');

    lines.push(
      `• ${p.title} — Vendor: ${p.vendor || 'n/a'} — Price: ${price || 'n/a'} — SKUs: ${skus || 'n/a'} — Tags: ${p.tags || ''}${optsPreview ? ` — Options: ${optsPreview}` : ''}`
    );
  }

  return lines.join('\n');
}

// ---------------- HTTP HANDLER ----------------
export default async function handler(req, res) {
  // --- CORS preflight ---
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin || '';
    if (ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // --- Health check / GET ---
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, path: '/api/chat' });
  }

  // --- CORS (request) ---
  const origin = req.headers.origin || '';
  if (!ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // --- Input ---
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  // --- Env check (only require OPENAI) ---
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  // --- Load local FAQ (optional) ---
  let faq = '';
  try {
    const faqPath = path.join(process.cwd(), 'data', 'faq.md');
    faq = fs.readFileSync(faqPath, 'utf8');
  } catch (_) {
    // ok if missing
  }

  // --- Load catalog once & retrieve relevant products ---
  const products = loadProductsCsvOnce();
  const matches = findRelevantProducts(prompt, 5);
  const catalogContext = formatProductsForContext(matches);

  // --- System prompt ---
  const system = [
    'You are The Phonograph Shop assistant.',
    'Be concise, specific, and helpful about products, parts fit, and store policies.',
    'Prefer grounded details from the provided Product Catalog Context and FAQ.',
    'If the info is not in the provided context, say you’re not sure (do NOT invent), and suggest the customer use the contact page.',
    'Do NOT include email addresses in your answers.',
  ].join(' ');

  const ground =
    (faq ? `\n\n### Store FAQ\n${faq}\n` : '') +
    (catalogContext
      ? `\n### Product Catalog Context (top matches)\n${catalogContext}\n`
      : '');

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system + '\n' + ground },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!resp.ok) {
      const details = await resp.text();
      return res
        .status(502)
        .json({ error: 'Upstream OpenAI error', details });
    }

    const data = await resp.json();
    let text = data.choices?.[0]?.message?.content?.trim() || '(no reply)';

    if (BLOCK_EMAIL) {
      // Replace any email-looking strings with “our contact page”
      text = text.replace(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
        'our contact page'
      );
      // Soft rewordings
      text = text.replace(/\bemail(s|ed|ing)?\b/gi, 'contact');
    }

    return res.status(200).json({
      ok: true,
      text,
      // Helpful debug to confirm matches (remove later if you want)
      debug: { matched_products: matches.map((m) => m.title) },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
