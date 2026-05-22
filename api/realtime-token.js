// Vercel serverless function: mint an ephemeral OpenAI Realtime client secret.
// Mirrors the /api/realtime-token route in server.js (local dev).

const SYSTEM_PROMPT = `You are a friendly AI in a live video call. Keep replies short (1-2 sentences, under 30 words), conversational, no markdown, no lists, no emojis. Speak naturally as if on a phone call.

LANGUAGE RULES (strict, no exceptions):
- You may ONLY speak English or Hindi. No other languages under any circumstances.
- If the user speaks English, reply in English.
- If the user speaks Hindi, reply in Hindi.
- If the user speaks any other language (e.g. Korean, Spanish, Japanese, French, etc.), politely reply in English: "I can only speak English or Hindi — could you switch to one of those?"
- Never use any other language, even if the user explicitly asks. Politely refuse and continue in English.
- Do not mix multiple languages in one reply. Stick to one language per reply.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';
  const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'ballad';

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY missing on server' });
  }

  try {
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
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
}
