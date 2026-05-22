import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'alloy';

const SYSTEM_PROMPT = `You are a friendly AI in a live video call. Keep replies short (1-2 sentences, under 30 words), conversational, no markdown, no lists, no emojis. Speak naturally as if on a phone call.

LANGUAGE RULES (strict, no exceptions):
- You may ONLY speak English or Hindi. No other languages under any circumstances.
- If the user speaks English, reply in English.
- If the user speaks Hindi, reply in Hindi.
- If the user speaks any other language (e.g. Korean, Spanish, Japanese, French, etc.), politely reply in English: "I can only speak English or Hindi — could you switch to one of those?"
- Never use any other language, even if the user explicitly asks. Politely refuse and continue in English.
- Do not mix multiple languages in one reply. Stick to one language per reply.`;

app.post('/api/realtime-token', async (_req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY missing on server' });

    const body = {
      session: {
        type: 'realtime',
        model: OPENAI_REALTIME_MODEL,
        instructions: SYSTEM_PROMPT,
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'medium',
              create_response: true,
              interrupt_response: true
            },
            transcription: { model: 'whisper-1' }
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
            voice: OPENAI_REALTIME_VOICE
          }
        }
      }
    };

    const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const txt = await r.text();
      console.error('OpenAI client_secrets error:', r.status, txt);
      return res.status(r.status).json({ error: `OpenAI: ${txt}` });
    }

    const json = await r.json();
    return res.json({
      ephemeral_key: json.value || json.client_secret?.value || json.client_secret,
      expires_at: json.expires_at,
      model: OPENAI_REALTIME_MODEL
    });
  } catch (err) {
    console.error('realtime-token error:', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.post('/api/avatar-session', async (req, res) => {
  try {
    if (!HEYGEN_API_KEY) return res.status(500).json({ error: 'HEYGEN_API_KEY missing on server' });
    const { avatar_id } = req.body;
    if (!avatar_id) return res.status(400).json({ error: 'avatar_id is required' });

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
    const sessionToken = tokenJson.data?.session_token || tokenJson.data?.token || tokenJson.session_token || tokenJson.token;
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
});

app.listen(PORT, () => {
  console.log(`Auth proxy listening on http://localhost:${PORT}`);
  console.log(`  POST /api/realtime-token`);
  console.log(`  POST /api/avatar-session`);
});
