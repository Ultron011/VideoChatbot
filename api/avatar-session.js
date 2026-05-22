// Vercel serverless function: create a HeyGen LiveAvatar LITE-mode session.
// Mirrors the /api/avatar-session route in server.js (local dev).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
  if (!HEYGEN_API_KEY) {
    return res.status(500).json({ error: 'HEYGEN_API_KEY missing on server' });
  }

  const { avatar_id } = req.body || {};
  if (!avatar_id) {
    return res.status(400).json({ error: 'avatar_id is required' });
  }

  try {
    const tokenResp = await fetch('https://api.liveavatar.com/v1/sessions/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': HEYGEN_API_KEY },
      body: JSON.stringify({ mode: 'LITE', avatar_id })
    });

    if (!tokenResp.ok) {
      const txt = await tokenResp.text();
      console.error('LiveAvatar token error:', tokenResp.status, txt);
      return res.status(tokenResp.status).json({ error: `LiveAvatar token: ${txt}` });
    }

    const tokenJson = await tokenResp.json();
    const sessionToken =
      tokenJson.data?.session_token ||
      tokenJson.data?.token ||
      tokenJson.session_token ||
      tokenJson.token;
    if (!sessionToken) {
      console.error('No session token in response:', tokenJson);
      return res.status(500).json({ error: 'No session token in LiveAvatar response' });
    }

    const startResp = await fetch('https://api.liveavatar.com/v1/sessions/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
      body: JSON.stringify({})
    });

    if (!startResp.ok) {
      const txt = await startResp.text();
      console.error('LiveAvatar start error:', startResp.status, txt);
      return res.status(startResp.status).json({ error: `LiveAvatar start: ${txt}` });
    }

    const startJson = await startResp.json();
    const d = startJson.data || startJson;
    return res.json({
      session_id: d.session_id,
      livekit_url: d.livekit_url,
      livekit_token: d.livekit_client_token,
      ws_url: d.ws_url
    });
  } catch (err) {
    console.error('avatar-session error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
