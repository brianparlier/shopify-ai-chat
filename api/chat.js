// Minimal, non-streaming proxy to OpenAI Responses API with strict CORS.
module.exports = async (req, res) => {
  // --- Allowed origins (your Shopify + Vercel domains) ---
  const allowedOrigins = [
    'https://thephonographshop.myshopify.com',
    'https://shopify-ai-chat-liard.vercel.app',
    'https://shopify-ai-chat-git-main-brian-parliers-projects.vercel.app',
    'https://shopify-ai-chat-fidghdvx7-brian-parliers-projects.vercel.app'
  ];

  const origin = req.headers.origin || '';
  const isAllowed = allowedOrigins.includes(origin);

  const setCors = () => {
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (isAllowed) res.setHeader('Access-Control-Allow-Origin', origin);
  };

  // --- Quick browser ping ---
  if (req.method === 'GET') {
    setCors();
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).end(JSON.stringify({ ok: true, path: '/api/chat' }));
  }

  // --- Preflight ---
  if (req.method === 'OPTIONS') {
    setCors();
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    setCors();
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).end(JSON.stringify({ error: 'method_not_allowed' }));
  }

  if (!isAllowed) {
    setCors();
    res.setHeader('Content-Type', 'application/json');
    return res.status(403).end(JSON.stringify({ error: 'origin_not_allowed', origin }));
  }

  // --- Parse JSON body (works whether body is pre-parsed or raw) ---
  const readJson = (req) =>
    new Promise((resolve) => {
      if (req.body && typeof req.body === 'object') return resolve(req.body);
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
      });
    });

  try {
    const { message, history } = await readJson(req);
    if (!message) {
      setCors();
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).end(JSON.stringify({ error: 'missing_message' }));
    }

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          { role: 'system', content: 'You are a helpful assistant for The Phonograph Shop.' },
          ...(Array.isArray(history) ? history : []),
          { role: 'user', content: message }
        ]
      })
    });

    const text = await r.text();
    if (!r.ok) {
      setCors();
      res.setHeader('Content-Type', 'application/json');
      return res.status(r.status).end(JSON.stringify({ error: 'openai_error', detail: text }));
    }

    const data = JSON.parse(text);
    const reply =
      data.output_text ||
      data.output?.[0]?.content?.find?.(c => c.type === 'output_text')?.text ||
      data.output?.[0]?.content?.[0]?.text ||
      '';

    setCors();
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).end(JSON.stringify({ reply }));
  } catch (e) {
    setCors();
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).end(JSON.stringify({ error: 'server_error', detail: String(e) }));
  }
};
