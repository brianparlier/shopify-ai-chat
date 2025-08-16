// api/chat.js
import fs from 'fs';
import path from 'path';

// -------- CORS --------
const ALLOWED_ORIGINS = new Set([
  'https://thephonographshop.myshopify.com',
  'https://thephonographshop.com',
  'https://www.thephonographshop.com',
]);

// -------- Helpers --------
const has = (v) => typeof v === 'string' && v.trim().length > 0;

function normalizeText(s) {
  return (s || '').toString().replace(/\s+/g, ' ').trim();
}

function scoreMatches(prompt, items, fields = ['title', 'body', 'tags']) {
  const q = normalizeText(prompt).toLowerCase();
  const terms = Array.from(new Set(q.split(/\W+/).filter(t => t.length > 2)));
  if (!terms.length) return [];

  return items
    .map((it) => {
      const hay = fields.map(f => (it[f] || '')).join(' ').toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score++;
      return { item: it, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(x => x.item);
}

function formatCatalogSlice(items) {
  return items.map(it => {
    const lines = [];
    lines.push(`- Title: ${normalizeText(it.title)}`);
    if (it.sku) lines.push(`  SKU: ${normalizeText(it.sku)}`);
    if (it.handle) lines.push(`  URL: https://thephonographshop.com/products/${it.handle}`);
    if (has(it.vendor)) lines.push(`  Brand: ${it.vendor}`);
    if (has(it.tags)) lines.push(`  Tags: ${Array.isArray(it.tags) ? it.tags.join(', ') : it.tags}`);
    if (has(it.body)) lines.push(`  Notes: ${normalizeText(it.body).slice(0, 300)}…`);
    return lines.join('\n');
  }).join('\n');
}

// -------- Local catalog (optional) --------
function readLocalCatalog() {
  try {
    const p = path.join(process.cwd(), 'data', 'catalog.json');
    const raw = fs.readFileSync(p, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch (_) {}
  return [];
}

// -------- Shopify search (hardened) --------
async function searchShopify(prompt) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token  = process.env.SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) return [];

  try {
    // compact, product-like query (works better with Shopify search)
    const raw = normalizeText(prompt).toLowerCase();
    const terms = Array.from(new Set(raw.split(/\W+/).filter(t => t.length > 2)));
    const compact = terms.join(' ').slice(0, 100);
    const biased  = compact.includes('spring')
      ? compact.replace(/\b(main\s*spring|spring)\b/gi, 'mainspring')
      : compact;

    const gql = `
      query SearchProducts($q: String!) {
        products(first: 10, query: $q) {
          edges {
            node {
              id
              title
              handle
              vendor
              tags
              variants(first: 1) { edges { node { sku } } }
              description
            }
          }
        }
      }
    `;

    async function run(q) {
      const resp = await fetch(`https://${domain}/api/2024-07/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Storefront-Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: gql, variables: { q } }),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(()=>'');
        console.error('Shopify query failed', resp.status, t);
        return [];
      }
      const data = await resp.json();
      const edges = data?.data?.products?.edges || [];
      return edges.map(e => {
        const n = e.node || {};
        const sku = n.variants?.edges?.[0]?.node?.sku || '';
        return {
          title: n.title,
          handle: n.handle,
          vendor: n.vendor,
          tags: n.tags,
          body: n.description,
          sku,
        };
      });
    }

    const a = await run(compact);
    const b = biased !== compact ? await run(biased) : [];
    const seen = new Set();
    const merged = [];
    for (const it of [...a, ...b]) {
      const key = `${it.handle}|${it.sku}|${it.title}`;
      if (!seen.has(key)) { seen.add(key); merged.push(it); }
    }
    return merged;
  } catch (err) {
    console.error('searchShopify error', err);
    return [];
  }
}

// -------- Handler --------
export default async function handler(req, res) {
  // CORS preflight
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

  // Health
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, path: '/api/chat' });
  }

  // CORS runtime
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

  // Env checks
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  // FAQ (optional)
  let faq = '';
  try {
    const p = path.join(process.cwd(), 'data', 'faq.md');
    faq = fs.readFileSync(p, 'utf8');
  } catch (_) {}

  // Catalog
  let catalog = readLocalCatalog();
  if (!catalog.length) catalog = await searchShopify(prompt);

  let top = [];
  if (catalog.length) {
    top = scoreMatches(prompt, catalog);
    if (!top.length) top = catalog.slice(0, 5);
  }

  const catalogBlock = top.length
    ? `\n\n### Catalog (top matches)\n${formatCatalogSlice(top)}\n`
    : '';

  const faqBlock = faq ? `\n\n### Store FAQ\n${faq}\n` : '';

  const system = [
    'You are The Phonograph Shop assistant.',
    'Answer concisely and only based on the provided Catalog/FAQ context when possible.',
    'If the answer is not in the context, say you are not sure and suggest the site contact page.',
    'When listing products, use exactly this format (max 3 items):',
    '- {Title} — {SKU} — {URL}',
    'Do not use markdown links; show plain URLs.',
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
      const details = await resp.text().catch(()=>'(no body)');
      return res.status(502).json({ error: 'Upstream OpenAI error', details });
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '(no reply)';
    return res.status(200).json({ ok: true, text });
  } catch (err) {
    console.error('OpenAI call error', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
