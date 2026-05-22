# LITE-mode + OpenAI Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewire the QA project so HeyGen LiveAvatar runs in LITE mode (rendering + lipsync only) and OpenAI's GA Realtime API owns the full voice pipeline (mic → STT → LLM → TTS → speakers), with browser-side PCM bridging between them.

**Architecture:** Browser holds two parallel realtime sessions. A `RTCPeerConnection` to OpenAI handles audio in/out; an AudioWorklet taps the model's PCM output and forwards 60ms base64 chunks over a WebSocket to HeyGen's LITE endpoint via `agent.speak`. The avatar's video arrives over a separate LiveKit room. The Express server is a thin auth proxy minting ephemeral tokens for both services.

**Tech Stack:** React 19 + Vite + TypeScript on the client; Express 5 on the server; `livekit-client` for HeyGen room subscription; native browser `RTCPeerConnection` + `AudioWorklet` (no OpenAI SDK needed for the WebRTC path); `@heygen/liveavatar-web-sdk` removed.

**Note on testing:** This project has no test framework configured and the work is fundamentally browser-side WebRTC orchestration. Verification is manual via the running dev server (`npm run dev`) — start a call, speak, observe avatar lipsync + audio reply. Each task ends with a concrete "verify" step rather than `pytest`.

**Note on git:** The repo is not currently a git repository. Task 0 initializes git so we can commit at each step. If the user prefers not to use git, skip the commit steps.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `server.js` | rewrite | Express auth proxy: `/api/realtime-token`, `/api/avatar-session` |
| `src/realtime/openaiRealtime.ts` | new | `OpenAIRealtimeClient` — owns WebRTC peer to OpenAI, taps PCM output, emits events |
| `src/realtime/pcm-tap.worklet.js` | new | AudioWorklet that converts Float32 → Int16 PCM frames and posts them |
| `src/avatar/liveAvatarLite.ts` | new | `LiveAvatarLiteClient` — owns LiveKit subscription + LITE WebSocket, exposes `speak(pcm)` |
| `src/App.tsx` | major refactor | Orchestrates both clients; strips FULL-mode SDK code |
| `package.json` | modify | Add `livekit-client`; remove `@heygen/liveavatar-web-sdk` |
| `.env` | already exists | Holds `HEYGEN_API_KEY`, `OPENAI_API_KEY` (+ optional realtime model/voice) |

---

## Task 0: Repo prep

**Files:** repo root

- [ ] **Step 1: Initialize git if not already**

Run:
```bash
cd /c/Users/91799/Desktop/QA
git rev-parse --is-inside-work-tree 2>/dev/null || git init
```

Expected: either `true` printed, or `Initialized empty Git repository...`.

- [ ] **Step 2: Add a `.gitignore` if missing**

Check whether `.gitignore` exists; if not, create with this content:

```
node_modules
dist
.env
*.log
.vscode
.DS_Store
```

- [ ] **Step 3: Baseline commit**

```bash
git add .gitignore docs/
git status
git commit -m "chore: add gitignore and design docs"
```

- [ ] **Step 4: Add OpenAI realtime env vars to `.env`**

Open `.env` (do NOT commit it). Confirm `OPENAI_API_KEY` and `HEYGEN_API_KEY` are present. Append if missing:

```
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VOICE=alloy
```

No commit (`.env` is gitignored).

---

## Task 1: Server — rewrite `server.js`

**Files:**
- Modify: `server.js` (full rewrite)

- [ ] **Step 1: Replace `server.js` entirely with the new auth-proxy implementation**

```javascript
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

const SYSTEM_PROMPT = `You are a friendly AI in a live video call. Keep replies short (1-2 sentences, under 30 words), conversational, no markdown, no lists, no emojis. Speak naturally as if on a phone call.`;

// Mint an ephemeral key for the browser to open a WebRTC peer with OpenAI Realtime.
app.post('/api/realtime-token', async (_req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY missing on server' });

    const body = {
      session: {
        type: 'realtime',
        model: OPENAI_REALTIME_MODEL,
        voice: OPENAI_REALTIME_VOICE,
        instructions: SYSTEM_PROMPT,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'medium',
          create_response: true,
          interrupt_response: true
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
});

// Create a HeyGen LITE-mode session: token → start. Returns LiveKit + WebSocket creds.
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
    const sessionToken = tokenJson.data?.token || tokenJson.token;
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
      session_id: d.session_id || d.id,
      livekit_url: d.livekit_url || d.url,
      livekit_token: d.livekit_token || d.access_token,
      room: d.room || d.room_name,
      ws_url: d.ws_url || d.websocket_url
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
```

- [ ] **Step 2: Verify it starts without throwing**

Run:
```bash
npm run server
```

Expected: `Auth proxy listening on http://localhost:3000` and both route lines printed. No exceptions. Hit `Ctrl+C` to stop.

- [ ] **Step 3: Smoke-test both endpoints with curl**

In one shell run `npm run server`. In another:

```bash
curl -s -X POST http://localhost:3000/api/realtime-token | head -c 200
curl -s -X POST http://localhost:3000/api/avatar-session -H "Content-Type: application/json" -d '{"avatar_id":"dd73ea75-1218-4ef3-92ce-606d5f7fbc0a"}' | head -c 400
```

Expected:
- First call returns JSON containing `ephemeral_key` starting with `ek_` or similar.
- Second call returns JSON with `livekit_url`, `livekit_token`, `ws_url`, `room`.

If either fails, the error body printed will name the upstream issue (bad key, mode rejection, etc). Fix env or payload and retry before moving on.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(server): rewrite as thin auth proxy for Realtime + LiveAvatar LITE"
```

---

## Task 2: AudioWorklet PCM tap

**Files:**
- Create: `public/pcm-tap.worklet.js` (served as a static URL so the worklet can be loaded by URL)

We put the worklet in `public/` because Vite serves that directory at the site root, which is what `AudioWorklet.addModule(url)` needs at runtime. The file is plain JS (worklets run outside the bundler).

- [ ] **Step 1: Create the worklet file**

```javascript
// public/pcm-tap.worklet.js
// Receives audio in the AudioWorkletGlobalScope, converts Float32 → Int16,
// batches to ~60ms chunks at 24kHz (1440 samples), and posts them to the main thread.

class PcmTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetSampleRate = opts.targetSampleRate || 24000;
    this.batchSamples = opts.batchSamples || 1440; // 60ms at 24kHz
    this.buffer = new Int16Array(this.batchSamples);
    this.writeIndex = 0;
  }

  // Linear resample if sampleRate (worklet global) != target.
  // Realtime API outputs 24kHz already; this resample path is for safety.
  resampleAndFlushFrame(channelData) {
    const ratio = sampleRate / this.targetSampleRate;
    const outLen = Math.floor(channelData.length / ratio);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, channelData.length - 1);
      const frac = srcIdx - lo;
      const sample = channelData[lo] * (1 - frac) + channelData[hi] * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.buffer[this.writeIndex++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this.writeIndex >= this.batchSamples) {
        // Post a copy so the underlying buffer can be reused.
        this.port.postMessage(this.buffer.slice(0, this.batchSamples));
        this.writeIndex = 0;
      }
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0]; // mono
    if (!channel) return true;
    this.resampleAndFlushFrame(channel);
    return true;
  }
}

registerProcessor('pcm-tap', PcmTapProcessor);
```

- [ ] **Step 2: Verify Vite serves it**

Start the dev server:
```bash
npm run client
```

Then in browser: open `http://localhost:5173/pcm-tap.worklet.js`. Expected: the file contents are served (200 OK). Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add public/pcm-tap.worklet.js
git commit -m "feat(realtime): add AudioWorklet PCM tap (Float32 → Int16 @ 24kHz)"
```

---

## Task 3: `OpenAIRealtimeClient`

**Files:**
- Create: `src/realtime/openaiRealtime.ts`

- [ ] **Step 1: Create the file with the full client implementation**

```typescript
// src/realtime/openaiRealtime.ts
// Owns the WebRTC PeerConnection to OpenAI's GA Realtime API.
// Plays model audio directly (low-latency) and taps PCM frames via an AudioWorklet
// so they can be forwarded to HeyGen LiveAvatar for lipsync.

export type RealtimeEvents = {
  onAudioFrame?: (pcm: Int16Array) => void;
  onUserStartedSpeaking?: () => void;
  onUserStoppedSpeaking?: () => void;
  onUserTranscript?: (text: string) => void;
  onAssistantTranscriptDelta?: (text: string) => void;
  onAssistantTranscriptDone?: (text: string) => void;
  onResponseDone?: () => void;
  onError?: (err: Error) => void;
};

export class OpenAIRealtimeClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private micStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private assistantTranscriptBuffer = '';
  private events: RealtimeEvents;

  constructor(events: RealtimeEvents) {
    this.events = events;
  }

  async start(backendBase: string): Promise<void> {
    // 1. Ephemeral token
    const tokResp = await fetch(`${backendBase}/api/realtime-token`, { method: 'POST' });
    if (!tokResp.ok) throw new Error(`realtime-token: ${await tokResp.text()}`);
    const { ephemeral_key, model } = await tokResp.json();
    if (!ephemeral_key) throw new Error('No ephemeral_key in /api/realtime-token response');

    // 2. PeerConnection + audio element for direct playback
    this.pc = new RTCPeerConnection();
    this.audioEl = document.createElement('audio');
    this.audioEl.autoplay = true;
    (this.audioEl as any).playsInline = true;

    this.pc.ontrack = (e) => {
      if (!this.audioEl) return;
      this.audioEl.srcObject = e.streams[0];
      // Attach the AudioWorklet tap on the remote track.
      this.attachPcmTap(e.streams[0]).catch((err) => this.events.onError?.(err));
    };

    // 3. Data channel for events
    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onopen = () => {
      // Re-assert config defensively (server already configured it via client_secrets).
      this.dc?.send(JSON.stringify({
        type: 'session.update',
        session: {
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'semantic_vad',
            eagerness: 'medium',
            create_response: true,
            interrupt_response: true
          }
        }
      }));
    };
    this.dc.onmessage = (e) => this.handleServerEvent(e.data);

    // 4. Mic
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    for (const t of this.micStream.getAudioTracks()) this.pc.addTrack(t, this.micStream);

    // 5. SDP exchange
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const sdpResp = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ephemeral_key}`,
        'Content-Type': 'application/sdp'
      },
      body: offer.sdp
    });
    if (!sdpResp.ok) throw new Error(`OpenAI SDP exchange failed: ${sdpResp.status} ${await sdpResp.text()}`);

    const answer = { type: 'answer' as const, sdp: await sdpResp.text() };
    await this.pc.setRemoteDescription(answer);
  }

  private async attachPcmTap(stream: MediaStream): Promise<void> {
    const ctx = new AudioContext({ sampleRate: 24000 });
    await ctx.audioWorklet.addModule('/pcm-tap.worklet.js');
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-tap', {
      processorOptions: { targetSampleRate: 24000, batchSamples: 1440 }
    });
    node.port.onmessage = (e) => {
      const pcm = e.data as Int16Array;
      this.events.onAudioFrame?.(pcm);
    };
    src.connect(node);
    // Do NOT connect node to ctx.destination — playback is via the <audio> element.
    this.audioCtx = ctx;
    this.workletNode = node;
  }

  private handleServerEvent(raw: string): void {
    let evt: any;
    try { evt = JSON.parse(raw); } catch { return; }
    switch (evt.type) {
      case 'input_audio_buffer.speech_started':
        this.events.onUserStartedSpeaking?.();
        break;
      case 'input_audio_buffer.speech_stopped':
        this.events.onUserStoppedSpeaking?.();
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (evt.transcript) this.events.onUserTranscript?.(evt.transcript);
        break;
      case 'response.audio_transcript.delta':
        if (evt.delta) {
          this.assistantTranscriptBuffer += evt.delta;
          this.events.onAssistantTranscriptDelta?.(evt.delta);
        }
        break;
      case 'response.audio_transcript.done': {
        const text = evt.transcript || this.assistantTranscriptBuffer;
        this.assistantTranscriptBuffer = '';
        if (text) this.events.onAssistantTranscriptDone?.(text);
        break;
      }
      case 'response.done':
        this.events.onResponseDone?.();
        break;
      case 'error':
        this.events.onError?.(new Error(evt.error?.message || JSON.stringify(evt)));
        break;
    }
  }

  cancelResponse(): void {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify({ type: 'response.cancel' }));
    }
  }

  setMicMuted(muted: boolean): void {
    if (!this.micStream) return;
    for (const t of this.micStream.getAudioTracks()) t.enabled = !muted;
  }

  // Send a typed message as a user turn and trigger a response.
  sendTextMessage(text: string): void {
    if (this.dc?.readyState !== 'open') return;
    this.dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
    }));
    this.dc.send(JSON.stringify({ type: 'response.create' }));
  }

  async stop(): Promise<void> {
    try { this.workletNode?.disconnect(); } catch {}
    try { await this.audioCtx?.close(); } catch {}
    this.workletNode = null;
    this.audioCtx = null;
    if (this.micStream) {
      for (const t of this.micStream.getTracks()) t.stop();
      this.micStream = null;
    }
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl = null;
    }
    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.dc = null;
    this.pc = null;
  }
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc -b
```

Expected: no errors. If TS complains about `playsInline` on `HTMLAudioElement`, the cast `(this.audioEl as any).playsInline = true;` already handles it.

- [ ] **Step 3: Commit**

```bash
git add src/realtime/openaiRealtime.ts
git commit -m "feat(realtime): add OpenAIRealtimeClient (WebRTC + PCM tap)"
```

---

## Task 4: `LiveAvatarLiteClient`

**Files:**
- Modify: `package.json` (add `livekit-client`, remove `@heygen/liveavatar-web-sdk`)
- Create: `src/avatar/liveAvatarLite.ts`

- [ ] **Step 1: Swap deps**

Run:
```bash
npm uninstall @heygen/liveavatar-web-sdk
npm install livekit-client
```

Expected: clean install. The `node_modules/@heygen` directory is removed.

- [ ] **Step 2: Create the client**

```typescript
// src/avatar/liveAvatarLite.ts
// Subscribes to the avatar's LiveKit room for video and drives lipsync by
// pushing PCM 16-bit 24kHz audio over a WebSocket via `agent.speak` commands.

import { Room, RoomEvent, RemoteTrack, RemoteParticipant, Track } from 'livekit-client';

export type LiteAvatarEvents = {
  onConnected?: () => void;
  onAvatarSpeakStarted?: () => void;
  onAvatarSpeakEnded?: () => void;
  onVideoTrack?: (stream: MediaStream) => void;
  onError?: (err: Error) => void;
};

export class LiveAvatarLiteClient {
  private room: Room | null = null;
  private ws: WebSocket | null = null;
  private connected = false;
  private events: LiteAvatarEvents;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private pendingAudio: string[] = []; // base64 chunks queued until connected

  constructor(events: LiteAvatarEvents) {
    this.events = events;
  }

  async start(backendBase: string, avatarId: string): Promise<void> {
    const resp = await fetch(`${backendBase}/api/avatar-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_id: avatarId })
    });
    if (!resp.ok) throw new Error(`avatar-session: ${await resp.text()}`);
    const { livekit_url, livekit_token, ws_url } = await resp.json();
    if (!livekit_url || !livekit_token || !ws_url) {
      throw new Error('avatar-session response missing livekit_url/livekit_token/ws_url');
    }

    // 1. LiveKit room (video only)
    this.room = new Room({ adaptiveStream: true, dynacast: true });
    this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, _p: RemoteParticipant) => {
      if (track.kind === Track.Kind.Video) {
        const ms = new MediaStream([track.mediaStreamTrack]);
        this.events.onVideoTrack?.(ms);
      }
      if (track.kind === Track.Kind.Audio) {
        // HeyGen may republish the audio we sent. Mute it so we don't double-play.
        // (Audio playback happens via the OpenAI <audio> element.)
        try { (track as any).setEnabled?.(false); } catch {}
      }
    });

    await this.room.connect(livekit_url, livekit_token);

    // 2. Control WebSocket
    this.ws = new WebSocket(ws_url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (e) => this.handleWsMessage(e.data);
    this.ws.onerror = () => this.events.onError?.(new Error('LiveAvatar WS error'));
    this.ws.onclose = () => { this.connected = false; };

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('No WS'));
      this.ws.onopen = () => resolve();
      setTimeout(() => reject(new Error('LiveAvatar WS open timeout')), 10000);
    });

    // Keep-alive: 4 minutes (session times out at 5 minutes of inactivity).
    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'session.keep_alive' }));
      }
    }, 4 * 60 * 1000);
  }

  private handleWsMessage(data: any): void {
    if (typeof data !== 'string') return;
    let evt: any;
    try { evt = JSON.parse(data); } catch { return; }
    switch (evt.type) {
      case 'session.state_updated':
        if (evt.state === 'connected') {
          this.connected = true;
          this.events.onConnected?.();
          // Flush any queued audio
          for (const a of this.pendingAudio) this.sendSpeakRaw(a);
          this.pendingAudio = [];
        } else if (evt.state === 'closed') {
          this.connected = false;
        }
        break;
      case 'agent.speak_started':
        this.events.onAvatarSpeakStarted?.();
        break;
      case 'agent.speak_ended':
        this.events.onAvatarSpeakEnded?.();
        break;
    }
  }

  speak(pcm: Int16Array): void {
    // Base64-encode the underlying bytes.
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const b64 = btoa(binary);

    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingAudio.push(b64);
      return;
    }
    // Backpressure: if WS is backed up over 1MB, drop and interrupt.
    if (this.ws.bufferedAmount > 1_000_000) {
      console.warn('[LiveAvatar] WS backpressure — dropping chunk + interrupting');
      this.interrupt();
      return;
    }
    this.sendSpeakRaw(b64);
  }

  private sendSpeakRaw(b64: string): void {
    this.ws?.send(JSON.stringify({ type: 'agent.speak', audio: b64 }));
  }

  speakEnd(): void {
    this.ws?.send(JSON.stringify({ type: 'agent.speak_end' }));
  }

  interrupt(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent.interrupt' }));
    }
  }

  async stop(): Promise<void> {
    if (this.keepAliveTimer) { clearInterval(this.keepAliveTimer); this.keepAliveTimer = null; }
    try { this.ws?.close(); } catch {}
    this.ws = null;
    try { await this.room?.disconnect(); } catch {}
    this.room = null;
    this.connected = false;
    this.pendingAudio = [];
  }
}
```

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc -b
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/avatar/liveAvatarLite.ts
git commit -m "feat(avatar): add LiveAvatarLiteClient (LiveKit + LITE WebSocket); drop heygen SDK"
```

---

## Task 5: Rewire `src/App.tsx`

**Files:**
- Modify: `src/App.tsx`

This task replaces the file. The Google Meet UI scaffolding is preserved verbatim where possible; the HeyGen FULL-mode SDK, echo-shield logic, voice override selector, and `/api/chat` calls are removed.

- [ ] **Step 1: Replace `src/App.tsx` entirely**

```tsx
import { useState, useEffect, useRef } from 'react';
import {
  Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Settings,
  MessageSquare, Sparkles, AlertCircle, Info, Send,
  Maximize2, Minimize2
} from 'lucide-react';
import { OpenAIRealtimeClient } from './realtime/openaiRealtime';
import { LiveAvatarLiteClient } from './avatar/liveAvatarLite';

type CallState = 'INACTIVE' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';

const PRESET_AVATARS = [
  { id: 'dd73ea75-1218-4ef3-92ce-606d5f7fbc0a', name: 'Sandbox Test Avatar' },
  { id: '8175dfc2-7858-49d6-b5fa-0c135d1c4bad', name: 'Elenora (Tech Expert)' },
  { id: '7b888024-f8c9-4205-95e1-78ce01497bda', name: 'Shawn (Therapist)' },
  { id: '0930fd59-c8ad-434d-ad53-b391a1768720', name: 'Dexter (Lawyer)' },
  { id: '65f9e3c9-d48b-4118-b73a-4ae2e3cbb8f0', name: 'June (HR)' }
];

const OPENAI_VOICES = [
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'
];

interface TranscriptItem {
  id: string;
  sender: 'user' | 'avatar';
  text: string;
}

export default function App() {
  const [selectedAvatar, setSelectedAvatar] = useState(PRESET_AVATARS[0].id);
  const [selectedVoice, setSelectedVoice] = useState(OPENAI_VOICES[0]);
  const [state, setState] = useState<CallState>('INACTIVE');
  const [error, setError] = useState<string | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const realtimeRef = useRef<OpenAIRealtimeClient | null>(null);
  const avatarRef = useRef<LiveAvatarLiteClient | null>(null);
  const assistantInProgressIdRef = useRef<string | null>(null);

  const [avatarAudioBars, setAvatarAudioBars] = useState<number[]>(new Array(15).fill(4));
  const [userAudioBars, setUserAudioBars] = useState<number[]>(new Array(15).fill(4));

  const backendBase = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  useEffect(() => {
    return () => {
      stopLocalCamera();
      realtimeRef.current?.stop();
      avatarRef.current?.stop();
    };
  }, []);

  // Bouncing bars when avatar is speaking
  useEffect(() => {
    let interval: any;
    if (avatarSpeaking) {
      interval = setInterval(() => {
        setAvatarAudioBars(Array.from({ length: 15 }, () => Math.floor(Math.random() * 28) + 8));
      }, 80);
    } else {
      setAvatarAudioBars(new Array(15).fill(4));
    }
    return () => clearInterval(interval);
  }, [avatarSpeaking]);

  // Bouncing bars when user is speaking
  useEffect(() => {
    let interval: any;
    if (userSpeaking) {
      interval = setInterval(() => {
        setUserAudioBars(Array.from({ length: 15 }, () => Math.floor(Math.random() * 28) + 8));
      }, 80);
    } else {
      setUserAudioBars(new Array(15).fill(4));
    }
    return () => clearInterval(interval);
  }, [userSpeaking]);

  const startLocalCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      localStreamRef.current = stream;
      if (userVideoRef.current) {
        userVideoRef.current.srcObject = stream;
        userVideoRef.current.play().catch(() => {});
      }
      setIsCameraOn(true);
    } catch (e) {
      console.warn('Camera failed:', e);
      setIsCameraOn(false);
    }
  };

  const stopLocalCamera = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    if (userVideoRef.current) userVideoRef.current.srcObject = null;
    setIsCameraOn(false);
  };

  const toggleCamera = () => isCameraOn ? stopLocalCamera() : startLocalCamera();

  const appendUserTranscript = (text: string) => {
    setTranscripts(prev => [...prev, { id: Math.random().toString(), sender: 'user', text }]);
  };

  const appendAssistantTranscriptDone = (text: string) => {
    setTranscripts(prev => {
      // If an in-progress assistant entry exists, finalize it.
      if (assistantInProgressIdRef.current) {
        const id = assistantInProgressIdRef.current;
        assistantInProgressIdRef.current = null;
        return prev.map(t => t.id === id ? { ...t, text } : t);
      }
      return [...prev, { id: Math.random().toString(), sender: 'avatar', text }];
    });
  };

  const appendAssistantDelta = (delta: string) => {
    setTranscripts(prev => {
      if (!assistantInProgressIdRef.current) {
        const newId = Math.random().toString();
        assistantInProgressIdRef.current = newId;
        return [...prev, { id: newId, sender: 'avatar', text: delta }];
      }
      const id = assistantInProgressIdRef.current;
      return prev.map(t => t.id === id ? { ...t, text: t.text + delta } : t);
    });
  };

  const handleStartCall = async () => {
    setError(null);
    setState('CONNECTING');
    setTranscripts([]);

    const avatar = new LiveAvatarLiteClient({
      onConnected: () => console.log('[Avatar] WS connected'),
      onAvatarSpeakStarted: () => setAvatarSpeaking(true),
      onAvatarSpeakEnded: () => setAvatarSpeaking(false),
      onVideoTrack: (ms) => {
        if (videoRef.current) {
          videoRef.current.srcObject = ms;
          videoRef.current.play().catch(() => {});
        }
      },
      onError: (e) => setError(e.message)
    });

    const realtime = new OpenAIRealtimeClient({
      onAudioFrame: (pcm) => avatar.speak(pcm),
      onUserStartedSpeaking: () => {
        setUserSpeaking(true);
        // Barge-in: stop the avatar and cancel any in-flight assistant response.
        avatar.interrupt();
      },
      onUserStoppedSpeaking: () => setUserSpeaking(false),
      onUserTranscript: (text) => appendUserTranscript(text),
      onAssistantTranscriptDelta: (delta) => appendAssistantDelta(delta),
      onAssistantTranscriptDone: (text) => appendAssistantTranscriptDone(text),
      onResponseDone: () => avatar.speakEnd(),
      onError: (e) => setError(e.message)
    });

    realtimeRef.current = realtime;
    avatarRef.current = avatar;

    try {
      await Promise.all([
        avatar.start(backendBase, selectedAvatar),
        realtime.start(backendBase)
      ]);
      setState('CONNECTED');
    } catch (e: any) {
      console.error('Start call failed:', e);
      setError(e.message || 'Failed to start call');
      setState('INACTIVE');
      await realtime.stop();
      await avatar.stop();
      realtimeRef.current = null;
      avatarRef.current = null;
    }
  };

  const handleEndCall = async () => {
    await realtimeRef.current?.stop();
    await avatarRef.current?.stop();
    realtimeRef.current = null;
    avatarRef.current = null;
    setState('INACTIVE');
    setAvatarSpeaking(false);
    setUserSpeaking(false);
    setIsImmersive(false);
    setShowSidebar(true);
  };

  const toggleMute = () => {
    const next = !isMuted;
    realtimeRef.current?.setMicMuted(next);
    setIsMuted(next);
  };

  const handleSendMessage = () => {
    if (!textInput.trim() || !realtimeRef.current) return;
    appendUserTranscript(textInput);
    realtimeRef.current.sendTextMessage(textInput);
    setTextInput('');
  };

  return (
    <div className={isImmersive ? 'immersive-active' : ''}>
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-pulse"></div>
          <h1 className="app-title">LiveCall AI</h1>
          <span className="app-subtitle">REALTIME • OPENAI + HEYGEN LITE</span>
        </div>
        {state !== 'INACTIVE' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className={`status-dot ${state === 'CONNECTED' ? 'active' : 'connecting'}`}></div>
            <span className="status-text">{state}</span>
          </div>
        )}
      </header>

      <main className="app-container">
        {error && (
          <div className="api-warning-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={18} /><strong>Connection Error</strong>
            </div>
            <p>{error}</p>
          </div>
        )}

        <div className="dashboard-grid">
          <section className="settings-panel">
            <h2 className="panel-title"><Settings size={18} /> Call Setup</h2>

            <div className="settings-section">
              <label className="settings-label">Avatar</label>
              <div className="select-wrapper">
                <select
                  className="custom-select"
                  value={selectedAvatar}
                  onChange={e => setSelectedAvatar(e.target.value)}
                  disabled={state !== 'INACTIVE'}
                >
                  {PRESET_AVATARS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>

            <div className="settings-section">
              <label className="settings-label">Voice (OpenAI Realtime)</label>
              <div className="select-wrapper">
                <select
                  className="custom-select"
                  value={selectedVoice}
                  onChange={e => setSelectedVoice(e.target.value)}
                  disabled={state !== 'INACTIVE'}
                >
                  {OPENAI_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                Voice is currently set server-side via OPENAI_REALTIME_VOICE. UI selection takes effect on next server restart.
              </p>
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.4 }}>
              <Info size={16} style={{ flexShrink: 0, color: 'var(--accent-teal)' }} />
              <span>
                Voice pipeline runs on OpenAI Realtime (GA). Avatar runs in HeyGen LITE mode for lipsync only. Barge-in is supported.
              </span>
            </div>
          </section>

          <section className="call-container">
            <div className="video-stage">
              <video ref={videoRef} className="avatar-video" playsInline autoPlay />

              <div className={`user-pip ${isImmersive && showSidebar ? 'shifted' : ''}`} onClick={toggleCamera}>
                <video
                  ref={userVideoRef}
                  className="user-video"
                  playsInline autoPlay muted
                  style={{ display: isCameraOn ? 'block' : 'none' }}
                />
                {!isCameraOn && (
                  <div className="user-pip-fallback">
                    <VideoOff size={18} /><span>Camera Off</span>
                  </div>
                )}
              </div>

              {state === 'CONNECTING' && (
                <div className="screen-overlay">
                  <div className="overlay-icon-container">
                    <div className="overlay-pulse-ring"></div>
                    <div className="overlay-pulse-ring-slow"></div>
                    <div className="overlay-icon-circle"><Sparkles size={32} /></div>
                  </div>
                  <h3 className="overlay-title">Connecting</h3>
                  <p className="overlay-desc">Opening OpenAI Realtime WebRTC + HeyGen LITE channels...</p>
                </div>
              )}

              {state === 'INACTIVE' && (
                <div className="screen-overlay">
                  <div className="overlay-icon-container">
                    <div className="overlay-icon-circle" style={{ background: 'var(--bg-tertiary)' }}>
                      <Phone size={32} style={{ color: 'var(--text-secondary)' }} />
                    </div>
                  </div>
                  <h3 className="overlay-title">Ready for Conversation</h3>
                  <p className="overlay-desc">Click Start Call to begin a live voice session.</p>
                  <button onClick={handleStartCall} className="control-btn start-call">
                    <Phone size={18} /> Start Call Session
                  </button>
                </div>
              )}
            </div>

            {state !== 'INACTIVE' && (
              <div className="call-controls-bar">
                <button onClick={toggleMute} className={`control-btn ${isMuted ? 'muted' : ''}`} data-tooltip={isMuted ? 'Unmute' : 'Mute'}>
                  {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
                <button onClick={toggleCamera} className={`control-btn ${isCameraOn ? 'active' : ''}`} data-tooltip={isCameraOn ? 'Camera Off' : 'Camera On'}>
                  {isCameraOn ? <Video size={18} /> : <VideoOff size={18} />}
                </button>
                {isImmersive && (
                  <button onClick={() => setShowSidebar(!showSidebar)} className={`control-btn ${showSidebar ? 'active' : ''}`} data-tooltip={showSidebar ? 'Hide Chat' : 'Show Chat'}>
                    <MessageSquare size={18} />
                  </button>
                )}
                <button onClick={() => setIsImmersive(!isImmersive)} className={`control-btn ${isImmersive ? 'active' : ''}`} data-tooltip={isImmersive ? 'Exit Full Screen' : 'Full Screen'}>
                  {isImmersive ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <button onClick={handleEndCall} className="control-btn end-call" data-tooltip="Hang Up">
                  <PhoneOff size={18} /> Hang Up
                </button>
              </div>
            )}

            <div className={`call-details-pane ${isImmersive && !showSidebar ? 'hidden' : ''}`}>
              <div className="transcript-box">
                <div className="transcript-header">
                  <h4 className="transcript-title"><MessageSquare size={16} /> Live Transcript</h4>
                  {state === 'CONNECTED' && <span className="badge-live">Live</span>}
                </div>
                <div className="transcript-list">
                  {transcripts.length === 0 ? (
                    <div className="transcript-placeholder">
                      <span>Speak to the avatar or type a message. Transcription will appear here.</span>
                    </div>
                  ) : (
                    transcripts.map(t => (
                      <div key={t.id} className={`transcript-item ${t.sender === 'user' ? 'user-bubble' : 'avatar-bubble'}`}>
                        <span className={`transcript-sender ${t.sender}`}>{t.sender === 'user' ? 'You' : 'Avatar'}</span>
                        <p className="transcript-text">{t.text}</p>
                      </div>
                    ))
                  )}
                  <div ref={transcriptEndRef} />
                </div>

                {state === 'CONNECTED' && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <input
                      type="text"
                      className="custom-select"
                      placeholder="Type a message (also speaks via Realtime)..."
                      value={textInput}
                      onChange={e => setTextInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                      style={{ flex: 1 }}
                    />
                    <button onClick={handleSendMessage} className="control-btn active" style={{ width: 42, height: 42, borderRadius: 12 }}>
                      <Send size={16} />
                    </button>
                  </div>
                )}
              </div>

              <div className="waveform-box">
                <div className="visualizer-card">
                  <div className="visualizer-label">
                    <span>AVATAR AUDIO ENERGY</span>
                    <span style={{ color: 'var(--accent-purple)' }}>{avatarSpeaking ? 'SPEAKING' : 'IDLE'}</span>
                  </div>
                  <div className="visualizer-bars-container">
                    {avatarAudioBars.map((h, i) => (
                      <div key={i} className={`visualizer-bar ${avatarSpeaking ? 'active-avatar' : ''}`} style={{ height: `${h}px` }} />
                    ))}
                  </div>
                </div>

                <div className="visualizer-card">
                  <div className="visualizer-label">
                    <span>YOUR VOICE INPUT</span>
                    <span style={{ color: isMuted ? 'var(--text-muted)' : userSpeaking ? 'var(--accent-teal)' : '#22c55e' }}>
                      {isMuted ? 'MUTED' : userSpeaking ? 'TALKING' : 'LISTENING'}
                    </span>
                  </div>
                  <div className="visualizer-bars-container">
                    {userAudioBars.map((h, i) => (
                      <div key={i} className={`visualizer-bar ${userSpeaking ? 'active-user' : ''}`} style={{ height: `${h}px` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Type-check & lint**

Run:
```bash
npx tsc -b
npm run lint
```

Expected: no errors. Warnings about unused imports are fine; remove any flagged ones.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): rewire UI to OpenAI Realtime + LiveAvatar LITE; drop FULL-mode SDK"
```

---

## Task 6: End-to-end manual verification

**Files:** none — verification only.

- [ ] **Step 1: Start the dev environment**

```bash
npm run dev
```

Wait until both the server (`Auth proxy listening on http://localhost:3000`) and the client (`Local: http://localhost:5173/`) print their banners.

- [ ] **Step 2: Open the app and start a call**

In a Chromium-based browser (Chrome/Edge — for `MediaStreamTrackProcessor`-equivalent worklet support), open `http://localhost:5173`. Grant microphone permission when prompted. Click **Start Call Session**.

Expected within ~5 seconds:
- Status pill shows `CONNECTING` → `CONNECTED`.
- Avatar video appears in the main video frame.
- No red error banner.

- [ ] **Step 3: Speak a greeting**

Say: "Hello, can you hear me?"

Expected:
- "YOUR VOICE INPUT" indicator flips to `TALKING` while you speak.
- After ~300-500ms of silence, "AVATAR AUDIO ENERGY" flips to `SPEAKING`.
- You hear an OpenAI voice replying (e.g., "Yes I can hear you!").
- The avatar's lips move roughly in sync with the audio (will trail audio by 200-400ms — expected).
- Both your transcript and the avatar's transcript appear in the Live Transcript panel.

- [ ] **Step 4: Test barge-in**

Ask a question that prompts a long reply: "Tell me a short story about a dragon."

Mid-reply, start talking: "Stop, change topic."

Expected:
- Avatar audio stops within ~200ms.
- Avatar visually returns to listening / idle.
- Your interruption is transcribed; a new reply begins.

- [ ] **Step 5: Test text input**

Click Mute. Type "What is two plus two?" in the input box and press Enter.

Expected:
- Avatar speaks the reply.
- Transcript shows both messages.

- [ ] **Step 6: Hang up**

Click Hang Up.

Expected:
- Avatar video disappears.
- All audio stops immediately.
- Status returns to `INACTIVE`.
- No errors in the browser console relating to dangling streams or sockets.

- [ ] **Step 7: Final commit (any cleanups discovered)**

If any minor fixes were needed during verification (CSS misalignment, console warnings), apply them and commit:

```bash
git add -A
git commit -m "fix: post-verification cleanups"
```

If the verification revealed substantive issues (audio piping wrong, lipsync silent, etc), do NOT patch over them — stop and report. The most likely root causes:

- HeyGen WS rejecting audio → check that PCM bytes are little-endian Int16 and base64 string matches docs format. Use browser devtools → Network → WS frames to inspect outgoing JSON.
- No video in avatar `<video>` → check LiveKit room subscription; usually means the avatar didn't enter the room. Inspect server `/api/avatar-session` response and try the call again.
- Audio plays but lips don't move → AudioWorklet may not be loading. Check console for `addModule` errors; confirm `http://localhost:5173/pcm-tap.worklet.js` returns the file.

---

## Plan self-review

**Spec coverage:**
- LITE-mode session creation → Task 1 (`/api/avatar-session`).
- OpenAI Realtime ephemeral token → Task 1 (`/api/realtime-token`).
- PCM tap via AudioWorklet → Task 2 + Task 3 (`attachPcmTap`).
- `agent.speak` audio forwarding → Task 4 (`LiveAvatarLiteClient.speak`).
- LiveKit video subscription → Task 4.
- Barge-in (cancel + interrupt) → Task 3 (`cancelResponse`, `interrupt_response: true`) + Task 5 (`onUserStartedSpeaking` handler).
- Removal of HeyGen FULL-mode SDK, echo shield, `/api/chat` → Task 5.
- Dep swap (`livekit-client` in, HeyGen SDK out) → Task 4 Step 1.
- Env vars (`OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`) → Task 0 Step 4 + Task 1.
- Manual end-to-end verification → Task 6.

**Placeholder scan:** none.

**Type consistency:** event names (`onAudioFrame`, `onUserStartedSpeaking`, `onAssistantTranscriptDelta`, `onAssistantTranscriptDone`, `onResponseDone`, `onVideoTrack`, `onAvatarSpeakStarted/Ended`) consistent across Task 3, 4, 5.
