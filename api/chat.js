// /api/chat.js  (no imports)

export default async function handler(req, res) {
  // Basic CORS for your Shopify domain + your Vercel domain
  const origin = req.headers.origin || '';
  const allowlist = [
    'https://thephonographshop.myshopify.com',
    'https://shopify-ai-chat-liard.vercel.app'
  ];
  if (allowlist.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, path: req.url });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(405).end('Method Not Allowed');
  }

  // For now, just echo to prove POST works
  let body = null;
  try {
    body = req.body ?? {};
  } catch {
    body = {};
  }
  return res.status(200).json({ ok: true, received: body });
}
