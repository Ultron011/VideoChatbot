# Design: HeyGen LiveAvatar LITE mode driven by OpenAI Realtime API (GA)

**Status:** Approved (pending user spec review)
**Date:** 2026-05-22

## Goal

Replace the current architecture — HeyGen `FULL` mode (HeyGen runs STT+LLM+TTS) plus a side-channel OpenAI Chat Completions call — with a **custom voice pipeline**:

- **HeyGen LiveAvatar `LITE` mode** for avatar rendering + lipsync only.
- **OpenAI Realtime API (GA)** as the full voice pipeline (STT, reasoning, TTS streaming) over WebRTC.

User-facing outcome: a Google Meet–style video call where the user can speak naturally to the avatar with end-to-end latency at the floor of what's achievable with remote LLM + remote avatar today (~250–400 ms perceived).

## Architecture

```
┌─────────── Browser ───────────┐         ┌───── Server (Express, thin) ─────┐
│                               │  POST   │  /api/realtime-token             │
│  Mic ──┐                      │ ──────▶ │    → OpenAI /v1/realtime/        │
│        ▼                      │         │      client_secrets              │
│  RTCPeerConnection ────────────────────▶                                   │
│   (OpenAI Realtime, GA)       │  POST   │  /api/avatar-session             │
│        │                      │ ──────▶ │    → LiveAvatar /v1/sessions/    │
│        │ ontrack (PCM16 24k)  │         │      token (mode:LITE) + start   │
│        ▼                      │         │    returns {livekit_url, room,   │
│  ┌──────────────────┐         │         │      livekit_token, ws_url}      │
│  │ AudioWorklet tap │         │         └──────────────────────────────────┘
│  └──────┬───────────┘
│         │ PCM frames (60ms batches @ 24kHz, base64)
│         ▼
│  WebSocket ─── agent.speak ───▶  HeyGen LiveAvatar (LITE)
│                                          │ renders lipsync video
│  LiveKit room ◀──────────────────────────┘
│         │ video track only
│         ▼
│  <video> element (avatar face)
│
│  Speaker ◀── OpenAI audio (direct, low-latency)
└───────────────────────────────┘
```

### Why this shape

- **User hears OpenAI audio directly** (chosen): lowest perceptible latency. Lipsync video trails by ~200–400 ms, which is acceptable and matches typical satellite-call experience.
- **Browser-side bridge** (chosen): one network hop instead of two. Server stays a thin auth proxy holding API keys.
- **Full barge-in support** (chosen): on OpenAI's `input_audio_buffer.speech_started`, send `response.cancel` to OpenAI and `agent.interrupt` to HeyGen.

## Components

### 1. `server.js` — rewritten

Replace both existing endpoints. New surface:

- `POST /api/realtime-token` — calls OpenAI `POST /v1/realtime/client_secrets`. Returns `{ ephemeral_key, expires_at }`. No request body needed from the client. Server reads `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL` (default `gpt-realtime`), `OPENAI_REALTIME_VOICE` (default `alloy`) from env.
- `POST /api/avatar-session` — body `{ avatar_id }`. Calls LiveAvatar `POST /v1/sessions/token` with `{ mode: "LITE", avatar_id }`, then `POST /v1/sessions/start` with the returned token. Returns `{ livekit_url, livekit_token, room, ws_url, session_id }`.

Remove `/api/chat` and the FULL-mode `/api/session-token`.

### 2. `src/realtime/openaiRealtime.ts` — new

`OpenAIRealtimeClient` class. Owns the OpenAI `RTCPeerConnection`.

Responsibilities:
- Fetch ephemeral token from `/api/realtime-token`.
- Create `RTCPeerConnection`, add mic track, register `ontrack` for model audio.
- Exchange SDP with OpenAI `/v1/realtime/calls` using ephemeral token.
- Send initial `session.update` event configuring:
  - `input_audio_format: "pcm16"` (24 kHz)
  - `output_audio_format: "pcm16"` (24 kHz)
  - `turn_detection: { type: "semantic_vad", eagerness: "medium", create_response: true, interrupt_response: true }`
  - `voice: <env-configured>`
  - `instructions: <conversational system prompt — same tone as today's: short, no markdown, natural>`
- Listen on the WebRTC data channel for events:
  - `input_audio_buffer.speech_started` → emit `onUserStartedSpeaking`
  - `conversation.item.input_audio_transcription.completed` → emit `onUserTranscript(text)`
  - `response.audio_transcript.delta` / `.done` → emit `onAssistantTranscript(text)`
  - `response.done` → emit `onResponseDone`
- Tap remote audio track via `MediaStreamTrackProcessor` (Chrome/Edge) with `AudioWorklet` fallback (Safari/Firefox). Convert Float32 → Int16, batch to **60 ms** chunks (1440 samples @ 24 kHz). Emit via `onAudioFrame(int16Array)`.
- Public methods: `start()`, `stop()`, `cancelResponse()` (sends `response.cancel` over data channel), `setMicMuted(bool)`.

### 3. `src/avatar/liveAvatarLite.ts` — new

`LiveAvatarLiteClient` class. Owns the HeyGen LITE session.

Responsibilities:
- Fetch session from `/api/avatar-session`.
- Connect to LiveKit room (`livekit-client`) as a subscriber. Subscribe to the avatar's video track; expose as `MediaStream` via `onVideoTrack`.
- Open WebSocket to `ws_url`. Wait for `session.state_updated` with `connected` before allowing speaks.
- Public methods:
  - `speak(int16Pcm)` — base64-encode and send `{ type: "agent.speak", audio }`. Internal queue + backpressure: if outstanding unacked bytes > 1MB, drop oldest and call `interrupt()`.
  - `speakEnd()` — send `{ type: "agent.speak_end" }`.
  - `interrupt()` — send `{ type: "agent.interrupt" }`.
  - `startListening()` / `stopListening()`.
  - `stop()` — close WebSocket, disconnect LiveKit.
- Emit events: `onConnected`, `onAvatarSpeakStarted`, `onAvatarSpeakEnded`, `onVideoTrack(MediaStream)`, `onError`.
- Keep-alive: send `session.keep_alive` every 4 minutes.

### 4. `src/App.tsx` — major surgery

Orchestrate the two clients. Keep all Google Meet UI scaffolding.

Changes:
- Remove all imports from `@heygen/liveavatar-web-sdk`.
- Remove `isEchoMatch`, `recentAvatarSpeechesRef`, auto-mute logic, `lastAvatarSpeakEndedRef` — obsolete (separate mic/output streams + native barge-in handle this).
- Remove `handleVoiceQuery` and `handleSendMessage` calls to `/api/chat` — text input now routes through OpenAI Realtime via `conversation.item.create` + `response.create`.
- Remove voice selection UI for HeyGen voices. Add a new dropdown for OpenAI Realtime voice (`alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`).
- Keep avatar selection (still HeyGen avatar IDs).
- `handleStartCall` flow:
  1. Create `LiveAvatarLiteClient`; on `onVideoTrack`, bind to `videoRef`.
  2. Create `OpenAIRealtimeClient`. Audio plays directly via its own `<audio>` element.
  3. Wire `realtime.onAudioFrame` → `avatar.speak(pcm)`.
  4. Wire `realtime.onResponseDone` → `avatar.speakEnd()`.
  5. Wire `realtime.onUserStartedSpeaking` → `avatar.interrupt()`.
  6. Wire `realtime.onUserTranscript` / `onAssistantTranscript` → update `transcripts` state.
  7. Wire `avatar.onAvatarSpeakStarted/Ended` → `setAvatarSpeaking`.
  8. Start both in parallel via `Promise.all`.

### 5. `package.json`

- **Add**: `livekit-client`
- **Remove**: `@heygen/liveavatar-web-sdk`

## Audio pipeline detail

- OpenAI Realtime configured with `output_audio_format: "pcm16"` at 24 kHz. The decoded PCM matches HeyGen's required format exactly — no resampling needed.
- Tap method: `MediaStreamTrackProcessor` → `ReadableStream` of `AudioData` frames → Int16 PCM. Fallback path: `AudioWorklet` node attached to a `MediaStreamAudioSourceNode`.
- Batch size: **60 ms** (1440 samples). Smaller batches tighten lipsync alignment without affecting audio latency (audio plays direct from OpenAI's `<audio>` element).
- Backpressure: track WebSocket `bufferedAmount`. If > 1 MB, drop oldest queued chunk and emit `agent.interrupt`. Log a warning.

## Barge-in flow

1. User starts speaking while avatar is mid-sentence.
2. OpenAI's semantic VAD fires `input_audio_buffer.speech_started` on the data channel.
3. `OpenAIRealtimeClient` calls `cancelResponse()` internally (sends `response.cancel`).
4. `App.tsx` listener also calls `avatar.interrupt()` over the HeyGen WebSocket.
5. Both pipelines stop within ~100 ms; new user audio is accumulated; new response starts when VAD detects turn-end.

## Latency targets

Realistic budget with all knobs tuned:

| Stage | Target |
|---|---|
| Mic → OpenAI (WebRTC + jitter) | 30–80 ms |
| Semantic VAD turn-end detection | 100–250 ms (down from 500 ms with server_vad) |
| OpenAI prefill (first audio token) | 150–300 ms |
| OpenAI → ear | 30–80 ms |
| **Total user-perceived** | **~310–710 ms** |

Speculative response (issuing `response.create` as soon as VAD confidence crosses threshold, canceling on continued speech) is built in via `semantic_vad`'s `create_response: true` flag.

Lipsync video trails audio by HeyGen's render lag (~200–400 ms). User sees a small audio/video skew similar to a long-distance call — acceptable.

OpenAI Realtime does not currently expose an APAC region for the GA endpoint; routing remains via OpenAI's default edge. We do not add region-pinning code.

## Environment variables

| Var | Required | Default |
|---|---|---|
| `HEYGEN_API_KEY` | yes | — |
| `OPENAI_API_KEY` | yes | — |
| `OPENAI_REALTIME_MODEL` | no | `gpt-realtime` |
| `OPENAI_REALTIME_VOICE` | no | `alloy` |

## Out of scope (for this iteration)

- Function calling / tool use through Realtime.
- Mid-session voice or avatar swapping.
- Recording / call persistence.
- Reconnect-on-drop logic beyond a clear error toast.
- Multi-language UI (Realtime API auto-detects input language; current EN-focused system prompt stays).

## Files touched

- `server.js` — rewrite
- `src/App.tsx` — major refactor
- `src/realtime/openaiRealtime.ts` — new
- `src/avatar/liveAvatarLite.ts` — new
- `src/realtime/audioTap.worklet.ts` — new (AudioWorklet fallback for Safari)
- `package.json` — dep swap

## Risks / open questions

- **`MediaStreamTrackProcessor` Safari support**: not available. AudioWorklet fallback is wired but adds complexity. Initial cut targets Chrome/Edge; Safari handled best-effort.
- **HeyGen LITE WebSocket connection from browser**: docs show server-side bridging is common, but the WebSocket is plain WSS with token auth, so browser direct-connect should work. If CORS blocks the WSS, we fall back to proxying through Express (adds ~20 ms but keeps architecture sound).
- **Avatar's WebRTC media stream** in LiveKit: confirm video-only (no audio track from HeyGen). If HeyGen also publishes an audio track in LITE mode (re-emitting what we sent), we mute it client-side to avoid double-playback.
