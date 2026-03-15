export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
    });
  }

  // GET request = health check (useful for testing)
  if (req.method === 'GET') {
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    const keyPreview = hasKey ? process.env.ANTHROPIC_API_KEY.slice(0, 12) + '...' + process.env.ANTHROPIC_API_KEY.slice(-4) : 'NOT SET';
    return Response.json({ status: 'ok', keyConfigured: hasKey, keyPreview });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ name: 'unknown', debug: 'Invalid request body' });
  }

  const { image, mimeType } = body;
  if (!image) {
    return Response.json({ name: 'unknown', debug: 'No image provided' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ name: 'unknown', debug: 'ANTHROPIC_API_KEY environment variable is not set' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: image },
            },
            {
              type: 'text',
              text: `Identify the Pokémon in this image. If it's a Pokémon card, also find the card number (usually printed at the bottom, like "4/102" or "025/198").

Respond in EXACTLY this JSON format, nothing else:
{"name": "pikachu", "cardNumber": "58/102"}

Rules:
- name: English name, lowercase, PokéAPI format (hyphens for spaces). Examples: "pikachu", "charizard", "mr-mime"
- cardNumber: the set number on the card like "4/102". If not visible or not a card, use null
- If you cannot identify any Pokémon, respond: {"name": "unknown", "cardNumber": null}`,
            },
          ],
        }],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return Response.json({ name: 'unknown', cardNumber: null, debug: data.error.message || JSON.stringify(data.error) });
    }

    const rawText = data.content?.[0]?.text?.trim() || '{"name":"unknown","cardNumber":null}';

    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      const name = rawText.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'unknown';
      parsed = { name, cardNumber: null };
    }

    return Response.json({ name: parsed.name || 'unknown', cardNumber: parsed.cardNumber || null });
  } catch (error) {
    return Response.json({ name: 'unknown', debug: 'Fetch error: ' + error.message });
  }
}
