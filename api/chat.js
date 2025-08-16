// api/chat.js
import fs from 'fs';
import path from 'path';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://thephonographshop.com, https://thephonographshop.myshopify.com'
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function setCors(res, origin) {
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin'); // avoid cache mixing
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Simple health check for non-POST (kept from your original)
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, path: '/api/chat' });
  }

  // Enforce allowed origins on actual requests
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  // Load FAQ text (optional)
  let faq = '';
  try {
    const faqPath = path.join(process.cwd(), 'data', 'faq.md');
    faq = fs.readFileSync(faqPath, 'utf8');
  } catch (_) {
    // no faq file is fine
  }

  const system = [
    'You are The Phonograph Shop assistant.',
    'Answer concisely, friendly, and only about store policies and products.',
    'When the FAQ contains the answer, use it. If not, say you’re not sure and suggest contacting support.',
  ].join(' ');

  const ground = faq ? `\n\n### Store FAQ\n${faq}\n\n` : '\n\n';

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
          { role: 'system', content: system + ground },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
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
