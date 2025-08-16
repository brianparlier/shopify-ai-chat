export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const isAllowed = !allowed.length || allowed.includes(origin);

  const setCors = () => {
    if (isAllowed && origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  };

  setCors();

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (!isAllowed) {
    return res.status(403).json({ error: 'Origin not allowed', origin });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    // Dummy OK (replace with your OpenAI call you already have)
    return res.status(200).json({ ok: true, text: `Hello, The Phonograph Shop! How can I assist you today?` });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'Upstream error' });
  }
}
