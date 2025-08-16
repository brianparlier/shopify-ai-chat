// /api/chat.js
const ALLOWED = new Set([
  "https://thephonographshop.myshopify.com",
  "https://thephonographshop.com"
]);

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;            // e.g. thephonographshop.myshopify.com
const TOKEN = process.env.SHOPIFY_STOREFRONT_API_TOKEN;    // Storefront API access token
const OPENAI = process.env.OPENAI_API_KEY;

function cors(res, origin) {
  if (ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function stripHtml(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPages() {
  if (!SHOP || !TOKEN) return { pages: [], note: "Missing SHOPIFY env" };

  const endpoint = `https://${SHOP}/api/2024-07/graphql.json`;
  const query = `
    {
      pages(first: 50) {
        nodes {
          handle
          title
          body
        }
      }
    }
  `;

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": TOKEN
    },
    body: JSON.stringify({ query })
  });

  if (!r.ok) {
    const t = await r.text();
    return { pages: [], note: `Storefront API error: ${t.slice(0,300)}` };
  }

  const data = await r.json();
  const nodes = data?.data?.pages?.nodes || [];
  const pages = nodes.map(n => ({
    handle: n.handle,
    title: n.title,
    text: stripHtml(n.body || "")
  }));
  return { pages, note: `ok:${pages.length}` };
}

function selectRelevant(pages, prompt) {
  const p = prompt.toLowerCase();
  const keyHandles = ["shipping", "faq", "return", "policy", "contact"];
  // 1) Prioritize by handle/title match
  const scored = pages.map(pg => {
    const hay = `${pg.handle} ${pg.title}`.toLowerCase();
    let score = 0;
    keyHandles.forEach((k, i) => { if (hay.includes(k)) score += (10 - i); });
    if (pg.text.toLowerCase().includes("shipping")) score += 3;
    if (pg.text.toLowerCase().includes("return")) score += 3;
    if (pg.text.toLowerCase().includes("warranty")) score += 2;
    if (pg.text.toLowerCase().includes("order")) score += 1;
    if (p.split(/\s+/).some(w => hay.includes(w))) score += 1;
    return { ...pg, score };
  });

  scored.sort((a,b)=>b.score-a.score);
  // keep top few pages as context
  return scored.slice(0, 4);
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  cors(res, origin);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(200).json({ ok: true, path: "/api/chat" });

  if (!ALLOWED.has(origin)) return res.status(403).json({ error: "Forbidden origin" });
  if (!OPENAI) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "Missing prompt" });

  const { pages, note } = await fetchPages();
  const relevant = selectRelevant(pages, prompt);

  const context = relevant.map(pg => `# ${pg.title}\n${pg.text}`).join("\n\n---\n\n");
  const system = [
    "You are The Phonograph Shop assistant.",
    "Use the provided store pages to answer questions about shipping, returns, policies, and general FAQs.",
    "If the answer is not in the context, say you’re not sure and suggest contacting julie@thephonographshop.com.",
    "Be concise and friendly."
  ].join(" ");

  const userMsg = [
    "Customer question:",
    prompt,
    "",
    "Store context (summaries of selected Shopify Pages):",
    context || "(no context available)"
  ].join("\n");

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg }
        ]
      })
    });

    if (!r.ok) {
      const details = await r.text();
      return res.status(502).json({ error: "Upstream OpenAI error", details, debug: note });
    }

    const data = await r.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ ok: true, text, debug: note });
  } catch (e) {
    return res.status(500).json({ error: "Server error", debug: note });
  }
}
