export default async function handler(req, res) {
  // Allow only your Shopify domain
  const allowedOrigin = "https://example.myshopify.com"; // change this to your store's URL
  if (req.headers.origin !== allowedOrigin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Allow CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages } = req.body;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // you can change model
        messages,
        stream: false // set to true if you want streaming
      })
    });

    const data = await response.json();
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.status(200).json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
