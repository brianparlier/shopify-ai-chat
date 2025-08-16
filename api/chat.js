// /api/chat.js

export default async function handler(req, res) {
  // --- CORS (allow only your shop + your Vercel domains) ---
  const origin = req.headers.origin || '';
  const allowlist = [
    'https://thephonographshop.myshopify.com',
    'https://shopify-ai-chat-liard.vercel.app',
    'https://shopify-ai-chat-git-main-brian-parliers-projects.vercel.app',
    'https://shopify-ai-chat-fidghdvx7-brian-parliers-projects.vercel.app'
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

  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, path: req.url });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return res.status(405).end('Method Not Allowed');
  }

  // --- Read input ---
  // Accept either { messages: [...] } or { prompt: "..." }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const messages = Array.isArray(body.messages)
    ? body.messages
    : [{ role: 'user', content: String(body.prompt || '').trim() }];

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }
  if (!messages?.[0]?.content) {
    return res.status(400).json({ error: 'Missing prompt/messages' });
  }

  try {
    // --- Call OpenAI (simple, non-streaming) ---
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.3
      })
    });

    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => '');
      return res.status(502).json({ error: 'Upstream OpenAI error', details: errTxt });
    }

    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || '';

    return res.status(200).json({ ok: true, text });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', details: String(err) });
  }
}
