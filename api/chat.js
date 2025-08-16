// api/chat.js
import fs from 'fs';
import path from 'path';

const ALLOWED_ORIGINS = new Set([
  'https://thephonographshop.myshopify.com',
  'https://thephonographshop.com',
]);

const MODEL = 'gpt-4o-mini';
const PAGES_CHAR_BUDGET = 4000;

function stripHtml(html = '') {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchShopifyPages() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token  = process.env.SHOPIFY_STOREFRONT_TOKEN;

  if (!domain || !token) {
    // Make the reason visible so the client can show it.
    return { text: '', error: 'Missing SHOPIFY env (SHOPIFY_STORE_DOMAIN or SHOPIFY_STOREFRONT_TOKEN)' };
  }

  const url = `https://${domain}/api/2024-07/graphql.json`;
  const query = `
    query Pages {
      pages(first: 50) {
        edges { node { title body } }
      }
    }
  `;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Storefront-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.error('Shopify pages fetch failed:', resp.status, txt);
    return { text: '', error: `Shopify pages fetch failed: ${resp.status}` };
  }

  const data = await resp.json().catch(() => ({}));
  const edges = data?.data?.pages?.edges || [];

  let combined = '';
  for (const { node } of edges) {
    const title = (node?.title || '').trim();
    const body = stripHtml(node?.body || '');
    const block = `\n\n### ${title}\n${body}`;
    if ((combined + block).length > PAGES_CHAR_BUDGET) break;
    combined += block;
  }
  return { text: combined, error: '' };
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin || '';
    if (ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // Health check
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, path: '/api/chat' });
  }

  // Origin check
  const origin = req.headers.origin || '';
  if (!ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Forbidden origin', got: origin });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Parse JSON body robustly (Vercel can give object or string)
  let prompt = '';
  try {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    prompt = raw.prompt;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  // OpenAI key guard
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  // Optional local FAQ
  let faq = '';
  try {
    const faqPath = path.join(process.cwd(), 'data', 'faq.md');
    faq = fs.readFileSync(faqPath, 'utf8');
  } catch (_) {}

  // Live Shopify Pages
  const pagesResp = await fetchShopifyPages();
  const pages = pagesResp.text || '';
  const pagesError = pagesResp.error;

  const system = [
    'You are The Phonograph Shop assistant.',
    'Use the provided store content to answer questions about products, fitment, shipping, returns, and policies.',
    'If the content does not include the answer, say you’re not sure and suggest contacting support.',
    'Be brief, friendly, and helpful.',
  ].join(' ');

  const ground =
    (faq ? `\n\n### FAQ\n${faq}\n` : '') +
    (pages ? `\n\n### PAGES\n${pages}\n` : '');

  // If Shopify content failed, still answer but include a gentle note for us to see in the client:
  const debugNote = pagesError ? ` [debug: ${pagesError}]` : '';

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system + ground },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!resp.ok) {
      const details = await resp.text();
      return res.status(502).json({ error: 'Upstream OpenAI error', details });
    }

    const data = await resp.json();
    const text = (data.choices?.[0]?.message?.content?.trim() || 'Sorry—something went wrong.') + debugNote;
    return res.status(200).json({ ok: true, text, hadShopifyError: !!pagesError });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error', details: String(err) });
  }
}
