import OpenAI from "openai";

export default async function handler(req, res) {
  // CORS + preflight
  const origin = req.headers.origin || "";
  const allow = [
    /https:\/\/.*\.myshopify\.com$/,                 // any Shopify preview
    /^https:\/\/thephonographshop\.com$/,            // your domain
    /https:\/\/.*\.vercel\.app$/                     // your Vercel previews
  ];
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).end();
  }
  if (!allow.some(rx => rx.test(origin))) {
    return res.status(403).json({ error: "Forbidden origin" });
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }

  // Accept various client payloads
  const { prompt, message, input, messages } = req.body || {};
  let userText = prompt || message || input || "";
  if (!userText && Array.isArray(messages) && messages.length) {
    const last = messages[messages.length - 1];
    userText = (typeof last === "string" ? last : last?.content) || "";
  }
  if (!userText) return res.status(400).json({ error: "Missing prompt" });

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: "You are a helpful assistant for The Phonograph Shop. Keep answers concise unless asked." },
        { role: "user", content: userText }
      ]
    });

    const text = completion.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ ok: true, text });
  } catch (err) {
    console.error(err?.response?.data || err);
    return res.status(502).json({
      error: "Upstream OpenAI error",
      details: err?.response?.data || err?.message || "unknown"
    });
  }
}
