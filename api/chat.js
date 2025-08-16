// api/chat.js
import fs from 'fs';
import path from 'path';

// ---------- CORS ----------
const ALLOWED_ORIGINS = new Set([
  'https://thephonographshop.myshopify.com',
  'https://thephonographshop.com',
  'https://www.thephonographshop.com',
]);

const has = (v) => typeof v === 'string' && v.trim().length > 0;
const normalizeText = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();

// ---------- CSV helpers ----------
function splitCSVRow(row) {
  // split by commas not inside quotes
  return row.match(/(?:"[^"]*"|[^,])+/g)?.map(s => {
    s = s.trim();
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/""/g, '"');
    return s;
  }) || [];
}

function parseCSV(text) {
  // strip BOM if present
  if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = (text || '').split(/\r?\n/).filter(l => l.trim().length);
  if (lines.length < 2) return [];
  const headers = splitCSVRow(lines[0]).map(h => h.trim().toLowerCase());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVRow(lines[i]);
    if (!cols.length) continue;
    const raw = {};
    headers.forEach((h, idx) => raw[h] = cols[idx] ?? '');

    // common Shopify export aliases
    const get = (...keys) =>
      keys.map(k => raw[k.toLowerCase()]).find(v => v && String(v).trim().length) || '';

    const title  = get('title', 'product title', 'name');
    const handle = get('handle');
    const vendor = get('vendor', 'brand');
    const tagsStr= get('tags', 'tag');
    const body   = get('body', 'body_html', 'description', 'product description');
    const sku    = get('sku', 'variant sku', 'variantsku');

    if (!title) continue;
    rows.push({
      title,
      handle,
      vendor,
      tags: tagsStr ? tagsStr.split(/\s*,\s*/).filter(Boolean) : [],
      body,
      sku
    });
  }
  return rows;
}

// ---------- Local catalog loaders ----------
function readLocalCatalog() {
  // Try JSON first
  try {
    const p = path.join(process.cwd(), 'data', 'catalog.json');
    const raw = fs.readFileSync(p, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) return arr;
  } catch (_) {}

  // Then CSV (your case)
  try {
    const p = path.join(process.cwd(), 'data', 'products.csv');
    const raw = fs.readFileSync(p, 'utf8');
    const arr = parseCSV(raw);
    if (Array.isArray(arr) && arr.length) return arr;
  } catch (_) {}

  return [];
}

// ---------- Lightweight relevance scoring (title > tags > body) ----------
function scoreMatches(prompt, items) {
  const q = normalizeText(prompt).toLowerCase();
  const terms = Array.from(new Set(q.split(/\W+/).filter(t => t.length > 2)));
  if (!terms.length) return [];

  return items.map(it => {
    const title = (it.title || '').toLowerCase();
    const tags  = Array.isArray(it.tags) ? it.tags.join(' ').toLowerCase() : (it.tags || '').toLowerCase();
    const body  = (it.body || '').toLowerCase();

    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 5;   // strong weight
      if (tags.includes(t))  score += 3;   // medium
      if (body.includes(t))  score += 1;   // light
    }
    return { item: it, score };
  })
  .filter(x => x.score > 0)
  .sort((a,b) => b.score - a.score)
  .slice(0, 3) // cap to keep prompts small & reliable
  .map(x => x.item);
}

function formatCatalogSlice(items) {
  return items.map(it => {
    const lines = [];
    lines.push(`- Title: ${normalizeText(it.title)}`);
    if (it.sku)    lines.push(`  SKU: ${normalizeText(it.sku)}`);
    if (it.handle) lines.push(`  URL: https://thephonographshop.com/products/${it.handle}`);
    if (has(it.vendor)) lines.push(`  Brand: ${it.vendor}`);
    if (has(it.tags))   lines.push(`  Tags: ${Array.isArray(it.tags) ? it.tags.join(', ') : it.tags}`);
    if (has(it.body))   lines.push(`  Notes: ${normalizeText(it.body).slice(0, 300)}…`);
    return lines.join('\n');
  }).join('\n');
}

// ---------- Handler ----------
export default async function handler(req, res) {
  // Preflight
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin || '';
    if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // Health
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, path: '/api/chat' });
  }

  // CORS check
  const origin = req.headers.origin || '';
  if (!ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Input
  const { prompt } = req.body || {};
  if (!has(prompt)) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  // Env
  const envStatus = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    SHOPIFY_STORE_DOMAIN: !!process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_STOREFRONT_TOKEN: !!process.env.SHOPIFY_STOREFRONT_TOKEN,
  };
  if (!envStatus.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY', debug: envStatus });
  }

  // FAQ (optional)
  let faq = '';
  try {
    const p = path.join(process.cwd(), 'data', 'faq.md');
    faq = fs.readFileSync(p, 'utf8');
  } catch (_) {}

  // Catalog (CSV/JSON)
  let catalog = [];
  try { catalog = readLocalCatalog(); } catch (_) {}

  // Score & pick top items (or none)
  const top = catalog.length ? scoreMatches(prompt, catalog) : [];

  // Build small, safe context
  const catalogBlock = top.length
    ? `\n\n### Catalog (top matches)\n${formatCatalogSlice(top)}\n`
    : `\n\n### Catalog\n(No direct matches found in this small slice; do not assert unavailability. Offer general guidance and suggest browsing products if relevant.)\n`;

  const faqBlock = faq ? `\n\n### Store FAQ\n${faq}\n` : '';

  // Tighten behavior to avoid overclaiming
  const system = [
    'You are The Phonograph Shop assistant.',
    'Answer concisely and base answers on the provided Catalog/FAQ context when possible.',
    'Never claim an item is unavailable or that we do not carry it unless the context explicitly states so.',
    'If the answer is not in the context, say you are not sure and suggest browsing or using the site contact page.',
    'When listing products, use exactly this format (max 3 items):',
    '- {Title} — {SKU} — {URL}',
    'Do not use markdown links; show plain URLs.',
    envStatus.SHOPIFY_STORE_DOMAIN && envStatus.SHOPIFY_STOREFRONT_TOKEN
      ? 'You may reference product titles, tags, vendor, short notes, and the product URL composed as https://thephonographshop.com/products/{handle}.'
      : 'Note: live Shopify access may be limited; rely on the context provided.',
  ].join(' ');

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        top_p: 1,
        presence_penalty: 0,
        frequency_penalty: 0,
        messages: [
          { role: 'system', content: system + faqBlock + catalogBlock },
          { role: 'user', content: normalizeText(prompt) },
        ],
      }),
    });

    if (!resp.ok) {
      const details = await resp.text();
      return res.status(502).json({
        error: 'Upstream OpenAI error',
        details,
        debug: { envStatus, hadCatalog: !!catalog.length, topItems: top.length }
      });
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '(no reply)';
    return res.status(200).json({
      ok: true,
      text,
      debug: { envStatus, hadCatalog: !!catalog.length, topItems: top.length }
    });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error', message: String(err), debug: { envStatus } });
  }
}
