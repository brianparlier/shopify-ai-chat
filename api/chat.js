// api/chat.js
import fs from 'fs';
import path from 'path';

const allowedOrigins = new Set([
  'https://thephonographshop.com',
  'https://thephonographshop.myshopify.com',
]);

async function fetchShopifyPages(handles = []) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_STOREFRONT_API_TOKEN;
  if (!domain || !token || !handles.length) return '';

  // Build a single GraphQL query using aliases so we fetch pages in one round-trip
  const aliasLines = handles.map((h, i) => {
    const alias = `p${i}`;
    return `${alias}: pageByHandle(handle: "${h}") { title body }`;
  }).join('\n');

  const query = `query PagesByHandle {
    ${aliasLines}
  }`;

  const resp = await fetch(`https://${domain}/api/2024-07/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Storefront-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`Shopify Storefront API error: ${resp.status} ${t}`);
  }

  const data = await resp.json();
  if (!data || !data.data) return '';

  // Concatenate page title + stripped body for each found page
  const strip = (html = '') => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  let corpus = '';
  handles.forEach((h, i) => {
    const alias = `p${i}`;
    const page = data.data[alias];
    if (page?.body || page?.title) {
      corpus += `\n\n### ${page.title || h}\n${strip(page.body || '')}`;
    }
  });
  return corpus.trim();
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', Array.from(allowedOrigins).join(', '));
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, path: '/api/chat' });
  }

  const origin = req.headers.origin || '';
  if (!allowedOrigins.has(origin)) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  // Optional: also read any local /data/*.md you already have
  let localDocs = '';
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.md'));
    localDocs = files.map(f => {
      const p = path.join(dataDir, f);
      return `\n\n### ${f}\n${fs.readFileSync(p, 'utf8')}`;
    }).join('\n');
  } catch (_) {}

  // Live pull from Shopify Pages (edit handles as you add pages)
  let shopifyDocs = '';
  try {
    shopifyDocs = await fetchShopifyPages([
      'faq',
      'shipping',
      'returns',
      'product-fit',   // create these pages in Online Store > Pages
      'warranty',
      'privacy-policy',
      'terms-of-service',
    ]);
  } catch (e) {
    console.error(e);
  }

  const system = [
    'You are The Phonograph Shop assistant.',
    'Answer concisely and only about store policies, shipping, returns, warranties, products, and fit advice.',
    'Prefer the provided Store Docs; if unsure, say you are not certain and suggest contacting support.',
  ].join(' ');

  const ground =
    (shopifyDocs ? `\n\n## Store Docs (Shopify Pages)\n${shopifyDocs}` : '') +
    (localDocs ? `\n\n## Store Docs (Local)\n${localDocs}` : '');

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: system + ground },
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!resp.ok) {
      const details = await resp.text();
      return res.status(502).json({ error: 'Upstream OpenAI error', details });
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    return res.status(200).json({ ok: true, text });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
