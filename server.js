import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so the React app can communicate with the server
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Secure API endpoint to generate a LiveAvatar session token
app.post('/api/session-token', async (req, res) => {
  try {
    const apiKey = process.env.HEYGEN_API_KEY;

    if (!apiKey) {
      console.error('HEYGEN_API_KEY is not defined in the environment variables.');
      return res.status(500).json({ 
        error: 'Server configuration error: LiveAvatar API key is missing on the server.' 
      });
    }

    const { avatar_id, voice_id, is_sandbox, language } = req.body;

    if (!avatar_id) {
      return res.status(400).json({ error: 'Missing required field: avatar_id' });
    }

    console.log(`Generating session token for Avatar: ${avatar_id}, Voice: ${voice_id || 'default'}, Sandbox: ${!!is_sandbox}`);

    // Build the request body following the LiveAvatar OpenAPI specification
    const requestBody = {
      mode: 'FULL',
      avatar_id: avatar_id,
      is_sandbox: !!is_sandbox,
      avatar_persona: {
        language: language || 'en'
      }
    };

    if (voice_id) {
      requestBody.avatar_persona.voice_id = voice_id;
    }

    const response = await fetch('https://api.liveavatar.com/v1/sessions/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`LiveAvatar API token error (${response.status}):`, errorText);
      return res.status(response.status).json({ 
        error: `Failed to retrieve token from LiveAvatar: ${errorText || response.statusText}`
      });
    }

    const json = await response.json();
    
    // According to OpenAPI: the response has schema Response_SDKSessionTokenSchema_
    // Usually contains token inside json.data?.token or json.token
    const token = json.data?.token || json.token || (json.data && json.data.session_token);

    if (!token) {
      console.error('Invalid token response format from LiveAvatar:', json);
      const errMsg = json.message || json.error || (json.data && (json.data.message || json.data.error)) || 'No session token was found in the response payload.';
      return res.status(500).json({ 
        error: `LiveAvatar API Error: ${errMsg}`
      });
    }

    console.log('Successfully generated LiveAvatar session token.');
    return res.json({ token });

  } catch (error) {
    console.error('Error generating streaming token:', error);
    return res.status(500).json({ 
      error: 'Internal server error while creating streaming token.',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Conversational AI endpoint proxying to OpenAI GPT-4o-mini
app.post('/api/chat', async (req, res) => {
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const { messages, avatarName } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Missing or invalid required field: messages' });
    }

    // Fallback if no OpenAI Key is defined to prevent crash
    if (!openaiApiKey) {
      console.warn('OPENAI_API_KEY is not defined. Using local fallback conversation mode.');
      const lastUserMsg = messages[messages.length - 1]?.content || '';
      
      // Let's create a beautiful, highly contextual local response
      let reply = "Hello there! I am your AI assistant. To enable true ChatGPT conversations, please make sure to add OPENAI_API_KEY to your backend .env file.";
      
      const query = lastUserMsg.toLowerCase();
      if (query.includes('hello') || query.includes('hi')) {
        reply = `Hi! I am ${avatarName || 'your AI calling assistant'}. Nice to meet you! Add an OpenAI API key in .env to experience a true real-time voice chat with me!`;
      } else if (query.includes('how are you')) {
        reply = "I am doing exceptionally well! Just standing here, ready to chat. I would love to talk about anything once my ChatGPT connection is wired up.";
      } else if (query.includes('name') || query.includes('who are you')) {
        reply = `I am ${avatarName || 'your interactive AI avatar'}. I run over low-latency WebRTC.`;
      } else if (query.includes('weather')) {
        reply = "It is always sunny and beautiful inside my digital world! Once you set up OpenAI, I can look up the real weather for you.";
      } else {
        reply = `You said: "${lastUserMsg}". I heard you loud and clear! To have a natural chat with me, please add your OPENAI_API_KEY to the .env file.`;
      }

      return res.json({
        reply,
        isFallback: true
      });
    }

    // Prepare system instructions depending on selected avatar
    const systemPrompt = `You are ${avatarName || 'an interactive AI live call avatar'}.
You are speaking to the user in a live low-latency WebRTC video call.
Your response MUST be extremely short, conversational, friendly, and natural (1 to 2 sentences maximum, keeping it under 30-40 words).
Avoid lists, bullet points, markdown, emojis, asterisks, or any complex notation, as your response will be converted directly to speech and read aloud.
Speak as if you are in a real telephone or FaceTime call.`;

    const requestBody = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content }))
      ],
      max_tokens: 150,
      temperature: 0.7
    };

    console.log(`Sending user message to OpenAI Chat Completion (${requestBody.model})...`);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenAI API error (${response.status}):`, errorText);
      return res.status(response.status).json({
        error: `Failed to retrieve response from OpenAI: ${response.statusText}`,
        details: errorText
      });
    }

    const json = await response.json();
    const reply = json.choices?.[0]?.message?.content?.trim() || "I'm sorry, I couldn't generate a response.";
    
    console.log(`OpenAI response generated successfully: "${reply}"`);
    return res.json({ reply, isFallback: false });

  } catch (error) {
    console.error('Error in /api/chat:', error);
    return res.status(500).json({
      error: 'Internal server error while processing chat response.',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Token endpoint available at http://localhost:${PORT}/api/session-token`);
});
