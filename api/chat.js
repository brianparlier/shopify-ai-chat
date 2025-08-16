// api/chat.js
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', 'https://thephonographshop.myshopify.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, path: '/api/chat' });
  }

  const origin = req.headers.origin || '';
  if (origin !== 'https://thephonographshop.myshopify.com') {
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

  // Load FAQ text (optional but recommended)
  let faq = '';
  try {
    const faqPath = path.join(process.cwd(), 'data', 'faq.md');
    faq = fs.readFileSync(faqPath, 'utf8');
  } catch (_) {
    // no faq file is fine
  }

  // Build a grounded instruction for the assistant
  const system = [
    'You are The Phonograph Shop assistant.',
    'Answer concisely, friendly, and only about store policies and products.',
    'When the FAQ contains the answer, use it. If not, say you’re not sure and suggest contacting support.',
  ].join(' ');

  const ground = faq ? `\n\n### Store FAQ\n${faq}\n\n` : '\n\n';

  try {
    // Using OpenAI Chat Completions (compatible with your existing setup)
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // fast + inexpensive
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
