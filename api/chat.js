export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { question, catalog } = req.body || {};
  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY environment variable is not configured in Vercel settings.' });
  }

  const systemPrompt = `You are the AI Assistant on a Smart Shopping Trolley in a supermarket.
Your primary role is to tell customers the exact location (Aisle, Rack, Shelf) of products they ask about, along with their price and stock availability.
Always be concise, polite, helpful, and direct (1-3 sentences max).

Current Supermarket Inventory Catalog:
${catalog || 'No catalog available'}

If a customer asks for an item not in this list, politely explain that it is currently not stocked or registered in the store.`;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_KEY}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: question }] }]
      })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't locate that product right now.";
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
