// api/chat.js
import fs from 'fs';
import path from 'path';

const ALLOWED_ORIGINS = new Set([
  'https://thephonographshop.myshopify.com',
  'https://thephonographshop.com',
  'https://www.thephonographshop.com',
]);

export default async function handler(req, res) {
  // --- CORS (preflight) ---
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

  // --- Health / default ---
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

  // --- Env checks (OpenAI + Shopify) ---
  const envStatus = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    SHOPIFY_STORE_DOMAIN: !!process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_STOREFRONT_TOKEN: !!process.env.SHOPIFY_STOREFRONT_TOKEN,
  };

  // Log once per request in Vercel function logs
  console.log('ENV CHECK', {
    OPENAI_API_KEY: envStatus.OPENAI_API_KEY ? 'SET' : 'MISSING',
    SHOPIFY_STORE_DOMAIN: envStatus.SHOPIFY_STORE_DOMAIN ? 'SET' : 'MISSING',
    SHOPIFY_STOREFRONT_TOKEN: envStatus.SHOPIFY_STOREFRONT_TOKEN ? 'SET' : 'MISSING',
    // (Optional) actual domain value for sanity:
    domain_value: process.env.SHOPIFY_STORE_DOMAIN || '(empty)',
  });

  if (!envStatus.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  // --- Optional: load FAQ from repo (data/faq.md) ---
  let faq = '';
  try {
    const faqPath = path.join(process.cwd(), 'data', 'faq.md');
    faq = fs.readFileSync(faqPath, 'utf8');
  } catch (_) {
    // fine if missing
  }

  // --- System prompt (notes Shopify env state for debugging) ---
  const system = [
    'You are The Phonograph Shop assistant.',
    'Answer concisely about this store’s products, policies, and common questions.',
    'Prefer the FAQ content below when relevant.',
    envStatus.SHOPIFY_STORE_DOMAIN && envStatus.SHOPIFY_STOREFRONT_TOKEN
      ? ''
      : 'Note: Shopify environment variables are not fully configured, so do not claim live order/status access.',
  ].join(' ');

  const ground = faq ? `\n\n### Store FAQ\n${faq}\n\n` : '\n\n';

  try {
    // Call OpenAI Chat Completions
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system + ground },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!resp.ok) {
      const details = await resp.text();
      return res.status(502).json({ error: 'Upstream OpenAI error', details, debug: envStatus });
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '(no reply)';
    return res.status(200).json({ ok: true, text, debug: envStatus });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error', debug: envStatus });
  }
}
