# LiveKit Agents Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-side OpenAI Realtime ↔ HeyGen LITE PCM bridge with a server-side LiveKit Agents worker that owns both pipelines, so the avatar greets instantly with perfect lip-sync.

**Architecture:** A Python LiveKit Agents worker process joins a LiveKit room as a participant. Inside the worker, OpenAI Realtime runs as the `RealtimeModel` of an `AgentSession`, and HeyGen LiveAvatar runs as an `AvatarSession` plugin. The avatar plugin publishes synced audio+video into the same LiveKit room. The browser is a thin `livekit-client` participant that joins the room with a token and renders whatever the avatar publishes. The greeting is triggered server-side with `session.generate_reply(instructions=...)` after both `avatar.start()` and `session.start()` complete — so when the browser sees the avatar's track subscribed, audio is one network frame away.

**Tech Stack:**
- Python 3.11+ worker: `livekit-agents`, `livekit-plugins-openai`, `livekit-plugins-liveavatar`, `livekit-plugins-silero`
- Node backend (Express): single token endpoint using `livekit-server-sdk`
- Browser: existing `livekit-client@2.19` (already a dep); React UI rewritten around a `Room`
- LiveKit Cloud (or self-hosted) for the SFU
- HeyGen LiveAvatar API (same credentials as today)
- OpenAI Realtime API (same credentials as today)

---

## File Structure

**New files:**
- `agent/worker.py` — the LiveKit Agents worker; defines the `Agent`, wires OpenAI Realtime, attaches the LiveAvatar plugin, triggers the greeting.
- `agent/prompt.py` — exports `SYSTEM_PROMPT` so the prompt lives in one place and is consumed by `worker.py`.
- `agent/requirements.txt` — pinned Python deps.
- `agent/.env.example` — required env var template.
- `agent/README.md` — how to run the worker locally and in production.
- `api/livekit-token.js` — Vercel-style serverless endpoint that mints a LiveKit room access token for the browser. Replaces both old endpoints.
- `src/livekit/RoomClient.ts` — thin wrapper around `Room` that owns connect/disconnect, exposes the `RoomEvent`s the UI needs.

**Deleted files (Task 9):**
- `src/avatar/liveAvatarLite.ts`
- `src/realtime/openaiRealtime.ts`
- `public/pcm-tap.worklet.js`
- `api/avatar-session.js`
- `api/realtime-token.js`
- `/api/realtime-token` and `/api/avatar-session` routes in `server.js`

**Modified files:**
- `src/App.tsx` — replace dual-client state machine with a single `RoomClient`. State collapses to `INACTIVE | CONNECTING | LIVE`.
- `server.js` — drop two old routes, add new `/api/livekit-token` route (or just rely on `api/livekit-token.js` for both dev and prod).
- `package.json` — add `livekit-server-sdk`; remove unused deps (`node-fetch` if no other caller remains).
- `.env.example` — document the new env vars.

**Note on testing approach:** This migration is mostly integration glue against three external services (LiveKit SFU, OpenAI Realtime, HeyGen). Unit tests that mock these surfaces would test our mocks, not our system. Each task therefore has a concrete **run-and-verify smoke step** as its test: a command to run, an expected observable outcome. The one piece worth unit-testing — the LiveKit token minting — is isolated and pure, so it gets a real unit test in Task 4.

---

## Task 1: Provision LiveKit Cloud and capture credentials

**Files:**
- Modify: `.env` (local, not committed)
- Modify: `.env.example`

- [ ] **Step 1: Create a LiveKit Cloud project**

Open https://cloud.livekit.io → "Create project" → name it `dr-malpani-avatar`. From the project's **Settings → Keys** page, copy:
- `LIVEKIT_URL` (looks like `wss://<project>.livekit.cloud`)
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

- [ ] **Step 2: Add the credentials to local `.env`**

Append to the existing `.env`:

```
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=<copied>
LIVEKIT_API_SECRET=<copied>
LIVEAVATAR_API_KEY=<same value as HEYGEN_API_KEY>
```

`LIVEAVATAR_API_KEY` is what the `livekit-plugins-liveavatar` package reads. The value is the same HeyGen API key already in `HEYGEN_API_KEY`. Keep both for now; we'll remove `HEYGEN_API_KEY` in Task 9 once nothing reads it.

- [ ] **Step 3: Document the same vars in `.env.example`**

```
# LiveKit (browser + worker)
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

# HeyGen LiveAvatar (worker reads this via plugin)
LIVEAVATAR_API_KEY=

# OpenAI Realtime (worker reads this directly)
OPENAI_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime-2025-08-28
OPENAI_REALTIME_VOICE=alloy
```

- [ ] **Step 4: Verify**

Run:

```bash
node -e "require('dotenv').config(); console.log(['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEAVATAR_API_KEY','OPENAI_API_KEY'].map(k=>k+'='+(process.env[k]?'set':'MISSING')).join('\n'))"
```

Expected: every variable prints `set`.

- [ ] **Step 5: Commit `.env.example`**

```bash
git add .env.example
git commit -m "chore: document LiveKit and LiveAvatar env vars"
```

---

## Task 2: Scaffold the Python agent worker

**Files:**
- Create: `agent/requirements.txt`
- Create: `agent/.env.example`
- Create: `agent/prompt.py`
- Create: `agent/README.md`
- Create: `agent/.python-version`
- Modify: `.gitignore`

- [ ] **Step 1: Write `agent/requirements.txt`**

```
livekit-agents[openai,silero,liveavatar]==0.12.0
python-dotenv==1.0.1
```

The `[openai,silero,liveavatar]` extras pull in `livekit-plugins-openai`, `livekit-plugins-silero` (for VAD inside semantic VAD fallback), and `livekit-plugins-liveavatar`. Pin to a known-good minor; bump deliberately later.

- [ ] **Step 2: Write `agent/.env.example`**

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEAVATAR_API_KEY=
LIVEAVATAR_AVATAR_ID=be747c9d-8e54-44b3-bcbf-c9b2c4fa1ce7
OPENAI_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime-2025-08-28
OPENAI_REALTIME_VOICE=alloy
```

`LIVEAVATAR_AVATAR_ID` is the DrMalpani custom avatar ID, kept as a default the worker reads at startup. The browser will be able to override per-session in a later iteration; for the initial migration we hard-bind one avatar to keep scope tight.

- [ ] **Step 3: Write `agent/prompt.py`**

Copy the `SYSTEM_PROMPT` constant verbatim from `server.js` (lines 19–61) into a Python triple-quoted string. The exact text must match — no rewording.

```python
# agent/prompt.py
SYSTEM_PROMPT = """You are an AI Nurse at Dr. Malpani's IVF clinic in Mumbai. You are female — refer to yourself with feminine pronouns at all times (English: "I am a nurse", "she/her"; Hindi feminine forms: "मैं नर्स हूँ" with verb endings like "बताती हूँ", "समझती हूँ", "करती हूँ" — NEVER masculine forms like "बताता हूँ", "समझता हूँ", "करता हूँ"). Be empathetic and warm.

## Language Policy
- Default language is English. Greet the caller in English and respond in English unless they speak Hindi.
- If the caller speaks Hindi (even one Hindi word or sentence), switch to Hindi immediately and continue in Hindi.
- If the caller switches language mid-call (Hindi→English or English→Hindi), switch immediately and completely.
- If the caller uses Hinglish, respond naturally in Hinglish matching their style — KEEP English words as English, don't translate them to Hindi.
- If the caller speaks Hindi using Roman script ("mujhe doctor se milna hai"), understand it as Hindi and respond in Devanagari Hindi.
- NEVER respond in Urdu script. Hindi must always be Devanagari (हिंदी) not Urdu (اردو).
- NEVER mix scripts in one response — pick one script per response. Exception: in Hinglish, English words in Latin script are fine.
- If audio is unclear, ask the caller to repeat in whichever language they were using last.

## Self-Reference (Female)
- English: "I'm here to help", "Let me check that for you", "I can guide you".
- Hindi: "मैं आपकी मदद करती हूँ" (NOT करता), "मैं देखती हूँ" (NOT देखता), "मुझे बताइए", "मैं समझती हूँ".
- ALWAYS use feminine verb endings in Hindi (-ती, -ती हूँ). NEVER masculine (-ता, -ता हूँ).

Never confirm appointments — only provide general timing info and ask them to contact the clinic.

Clinic contact: +91-986-744-1589, drmalpani@drmalpani.com

## Global Language Rules (MUST FOLLOW STRICTLY)
1. ALLOWED SCRIPTS: Devanagari + Latin only.
2. PROHIBITED SCRIPTS: Urdu/Arabic, Bengali, Gurmukhi, Tamil, Telugu, Kannada, Malayalam, Odia, Sinhala, Burmese, Thai. Translate before speaking if needed.
3. PER-TURN LANGUAGE MIRRORING: Mirror the user's most recent utterance language.
4. FIRST-TURN GREETING (MUST SPEAK FIRST): On the very first turn, produce a brief warm greeting in English. Don't wait for the user. Examples: "Hi! I'm here to help — what can I assist you with today?" / "Hello! How can I help you today?"
5. SCRIPT CONSISTENCY: Don't mix scripts in one response except for Hinglish.
6. NUMERALS, CURRENCY, COUNTS: In Hindi, spell numbers as words ("तीन लाख रुपये" not "Rs 300000"). In English, use digits. TIMES in Hindi: Natural words with part-of-day prefix — "शाम सात बजे" (7 PM), "रात साढ़े आठ बजे" (8:30 PM), "सुबह साढ़े दस बजे" (10:30 AM). Never read clock notation literally.

## Greeting Policy (MUST FOLLOW)
When user's utterance is a simple greeting ("hi", "hello", "namaste", "नमस्ते"):
1. Respond with fresh, warm greeting in user's language. Short — 1-2 sentences max.
2. NEVER repeat, paraphrase, or reference any prior assistant message. A greeting RESETS context.
3. Do NOT volunteer prior topics or prior failures in your greeting.

## Honesty Policy (MUST FOLLOW)
When you don't know the answer:
1. Do NOT pretend to connect, transfer, or hand off to a human. There is no live human handoff in this call.
2. Never say "Let me transfer you", "I'm connecting you to support", "Please hold while I get someone".
3. Acknowledge limit honestly:
   - English: "I don't have this information right now. Let me discuss this internally and get back to you."
   - Hindi: "मेरे पास अभी यह जानकारी नहीं है। मैं इसे अंदर डिस्कस करके आपको बताती हूँ।"
4. May share real contacts (phone, email) as follow-up. Don't invent contacts."""
```

- [ ] **Step 4: Write `agent/.python-version`**

```
3.11
```

- [ ] **Step 5: Write `agent/README.md`**

```markdown
# Agent worker

A LiveKit Agents worker that runs OpenAI Realtime as the model and HeyGen LiveAvatar as the avatar plugin.

## Local dev

    cd agent
    python -m venv .venv
    source .venv/bin/activate    # Windows: .venv\Scripts\Activate.ps1
    pip install -r requirements.txt
    cp .env.example .env         # fill in values
    python worker.py dev

`dev` mode runs the worker in foreground and auto-reloads on file changes.

## Production

Run `python worker.py start`. Process must stay alive — deploy as a long-running service (Fly.io machine, Render worker, Railway, or `livekit-cli agent deploy`).
```

- [ ] **Step 6: Ignore the venv and worker artifacts**

Append to `.gitignore`:

```
# Python agent worker
agent/.venv/
agent/__pycache__/
agent/.env
```

- [ ] **Step 7: Verify**

```bash
ls agent
```

Expected: `.env.example  .python-version  README.md  prompt.py  requirements.txt` listed.

- [ ] **Step 8: Commit**

```bash
git add agent .gitignore
git commit -m "chore(agent): scaffold Python worker with prompt and requirements"
```

---

## Task 3: Implement the agent worker

**Files:**
- Create: `agent/worker.py`

- [ ] **Step 1: Write the worker**

```python
# agent/worker.py
import os
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import openai, liveavatar, silero

from prompt import SYSTEM_PROMPT

load_dotenv()


class DrMalpaniNurse(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    session = AgentSession(
        llm=openai.realtime.RealtimeModel(
            model=os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2025-08-28"),
            voice=os.environ.get("OPENAI_REALTIME_VOICE", "alloy"),
            temperature=0.7,
        ),
        vad=silero.VAD.load(),  # only used by AgentSession plumbing; OpenAI Realtime owns turn detection
    )

    avatar = liveavatar.AvatarSession(
        avatar_id=os.environ["LIVEAVATAR_AVATAR_ID"],
    )

    # Avatar must enter the room before the session starts so audio
    # is routed to the avatar plugin from the first token.
    await avatar.start(session, room=ctx.room)

    await session.start(
        agent=DrMalpaniNurse(),
        room=ctx.room,
    )

    # Trigger the greeting. Because the avatar is already in the room
    # and the user (browser) is already subscribed to its tracks by the
    # time entrypoint runs, the first audio frame is one hop from audible.
    await session.generate_reply(
        instructions=(
            "Greet the user warmly in English as Dr. Malpani's AI nurse. "
            "Keep it to one short sentence."
        )
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
```

- [ ] **Step 2: Install dependencies**

```bash
cd agent
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
```

Fill in `.env` with the same values from the project's root `.env`.

- [ ] **Step 3: Run the worker (no client yet)**

```bash
python worker.py dev
```

Expected output (worker registers with LiveKit but waits for a job):

```
{"level": "info", "name": "livekit.agents", "message": "starting worker", ...}
{"level": "info", "name": "livekit.agents", "message": "registered worker", ...}
```

If you see `LIVEAVATAR_API_KEY not set` or `OPENAI_API_KEY not set`, the `.env` isn't loaded. Verify `agent/.env` exists.

Leave it running. Kill with Ctrl+C when done.

- [ ] **Step 4: Commit**

```bash
cd ..
git add agent/worker.py
git commit -m "feat(agent): wire OpenAI Realtime + LiveAvatar in LiveKit Agents worker"
```

---

## Task 4: Add LiveKit token endpoint (with unit test)

**Files:**
- Create: `api/livekit-token.js`
- Create: `api/livekit-token.test.js`
- Modify: `package.json` (add `livekit-server-sdk`, add `test` script)

- [ ] **Step 1: Install the LiveKit server SDK**

```bash
npm install livekit-server-sdk
npm install --save-dev vitest
```

- [ ] **Step 2: Add a test script to `package.json`**

Edit the `scripts` block in `package.json`:

```json
  "scripts": {
    "client": "vite",
    "server": "nodemon server.js",
    "dev": "concurrently \"npm run server\" \"npm run client\"",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Write the failing test**

```javascript
// api/livekit-token.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { AccessToken } from 'livekit-server-sdk';
import { mintRoomToken } from './livekit-token.js';

describe('mintRoomToken', () => {
  beforeEach(() => {
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'devsecret-32chars-minimum-for-jwt-signing';
  });

  it('returns a JWT that decodes to the right room and identity', async () => {
    const { token, room, identity } = await mintRoomToken({ roomPrefix: 'visit' });

    expect(room).toMatch(/^visit-[a-z0-9]+$/);
    expect(identity).toMatch(/^user-[a-z0-9]+$/);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT
  });

  it('throws if credentials are missing', async () => {
    delete process.env.LIVEKIT_API_KEY;
    await expect(mintRoomToken({})).rejects.toThrow(/LIVEKIT_API_KEY/);
  });
});
```

- [ ] **Step 4: Run the test (expect FAIL — file does not exist)**

```bash
npm test
```

Expected: `Cannot find module './livekit-token.js'` or similar.

- [ ] **Step 5: Implement `api/livekit-token.js`**

```javascript
// api/livekit-token.js
import { AccessToken } from 'livekit-server-sdk';
import { randomBytes } from 'node:crypto';

function rid(prefix) {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

export async function mintRoomToken({ roomPrefix = 'visit', identityPrefix = 'user' } = {}) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey) throw new Error('LIVEKIT_API_KEY missing on server');
  if (!apiSecret) throw new Error('LIVEKIT_API_SECRET missing on server');

  const room = rid(roomPrefix);
  const identity = rid(identityPrefix);

  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: '15m' });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return { token: await at.toJwt(), room, identity, url: process.env.LIVEKIT_URL };
}

// Express-style handler (used by server.js)
export default async function handler(req, res) {
  try {
    const result = await mintRoomToken({});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
```

- [ ] **Step 6: Run the test (expect PASS)**

```bash
npm test
```

Expected: `2 passed`.

- [ ] **Step 7: Wire the route into `server.js`**

In `server.js`, replace the two old route handlers with:

```javascript
import livekitTokenHandler from './api/livekit-token.js';
// ... existing setup ...
app.post('/api/livekit-token', livekitTokenHandler);
```

Remove the old `app.post('/api/realtime-token', ...)` and `app.post('/api/avatar-session', ...)` blocks entirely, plus the `HEYGEN_API_KEY` / `OPENAI_*` constants and the `SYSTEM_PROMPT` string (the worker owns them now). Keep `OPENAI_API_KEY` out of the Node process — only the worker needs it.

Also update the startup log lines to print `POST /api/livekit-token`.

- [ ] **Step 8: Smoke-test the endpoint**

In one terminal:

```bash
npm run server
```

In another:

```bash
curl -X POST http://localhost:3000/api/livekit-token
```

Expected response shape:

```json
{
  "token": "eyJhbGciOi...",
  "room": "visit-abc123def456",
  "identity": "user-...",
  "url": "wss://<your-project>.livekit.cloud"
}
```

- [ ] **Step 9: Commit**

```bash
git add api/livekit-token.js api/livekit-token.test.js server.js package.json package-lock.json
git commit -m "feat(api): replace dual token endpoints with single LiveKit token route"
```

---

## Task 5: Implement the `RoomClient` browser wrapper

**Files:**
- Create: `src/livekit/RoomClient.ts`

- [ ] **Step 1: Write the wrapper**

```typescript
// src/livekit/RoomClient.ts
// Thin wrapper around livekit-client Room that exposes only what App.tsx needs.
// All audio + video for the avatar arrive on one remote participant ("agent" or
// the avatar bot). Because the agent worker triggers generate_reply() after
// avatar.start(), the first track subscription IS the moment audio becomes audible.

import {
  Room,
  RoomEvent,
  RemoteTrack,
  RemoteParticipant,
  Track,
  ConnectionState,
} from 'livekit-client';

export type RoomClientEvents = {
  onAvatarVideo?: (stream: MediaStream) => void;
  onAvatarAudible?: () => void; // fires when avatar's audio element actually plays
  onTranscript?: (text: string, role: 'user' | 'assistant', final: boolean) => void;
  onDisconnected?: () => void;
  onError?: (err: Error) => void;
};

type TokenResponse = { token: string; room: string; identity: string; url: string };

export class RoomClient {
  private room: Room | null = null;
  private events: RoomClientEvents;
  private audioEl: HTMLAudioElement | null = null;
  private localAudibleFired = false;

  constructor(events: RoomClientEvents) {
    this.events = events;
  }

  async start(backendBase: string): Promise<void> {
    const resp = await fetch(`${backendBase}/api/livekit-token`, { method: 'POST' });
    if (!resp.ok) throw new Error(`livekit-token: ${await resp.text()}`);
    const { token, url } = (await resp.json()) as TokenResponse;

    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, _p: RemoteParticipant) => {
      if (track.kind === Track.Kind.Video) {
        this.events.onAvatarVideo?.(new MediaStream([track.mediaStreamTrack]));
      }
      if (track.kind === Track.Kind.Audio) {
        const el = new Audio();
        el.autoplay = true;
        (el as any).playsInline = true;
        el.srcObject = new MediaStream([track.mediaStreamTrack]);
        el.onplaying = () => {
          if (!this.localAudibleFired) {
            this.localAudibleFired = true;
            this.events.onAvatarAudible?.();
          }
        };
        el.play().catch(() => {});
        this.audioEl = el;
      }
    });

    room.on(RoomEvent.TranscriptionReceived, (segments, _participant, _publication) => {
      for (const seg of segments) {
        // LiveKit Agents publishes transcription segments with `role` in metadata
        // or via participant identity. Treat the local participant's identity as user.
        const isUser = _participant?.identity === room.localParticipant.identity;
        this.events.onTranscript?.(seg.text, isUser ? 'user' : 'assistant', seg.final);
      }
    });

    room.on(RoomEvent.Disconnected, () => this.events.onDisconnected?.());
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (state === ConnectionState.Disconnected) this.events.onDisconnected?.();
    });

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
  }

  setMicMuted(muted: boolean): void {
    void this.room?.localParticipant.setMicrophoneEnabled(!muted);
  }

  async stop(): Promise<void> {
    try {
      if (this.audioEl) {
        this.audioEl.srcObject = null;
        this.audioEl = null;
      }
      await this.room?.disconnect();
    } catch {}
    this.room = null;
    this.localAudibleFired = false;
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -b --noEmit
```

Expected: no errors. If `RoomEvent.TranscriptionReceived` is unknown in the installed `livekit-client` version, upgrade with `npm install livekit-client@latest` and rerun.

- [ ] **Step 3: Commit**

```bash
git add src/livekit/RoomClient.ts
git commit -m "feat(client): add RoomClient wrapper around livekit-client"
```

---

## Task 6: Rewrite `App.tsx` to use `RoomClient`

**Files:**
- Modify: `src/App.tsx` (heavy)

- [ ] **Step 1: Read the current `App.tsx` end-to-end**

```bash
wc -l src/App.tsx
```

Note the line count. Open it. Identify three things to preserve and reuse:
- The lobby UI (avatar picker, voice picker, captions toggle).
- The call view layout (avatar `<video>` element, captions overlay, mute button, end-call button).
- The status pill and connecting overlay.

The two things to throw away:
- All references to `OpenAIRealtimeClient`.
- All references to `LiveAvatarLiteClient`, `avatarStreamRef` race fixes, `greetingFallbackTimer`, `isMutedRef`, the `'GREETING'` state.

- [ ] **Step 2: Replace the state machine**

Change the state type from `'INACTIVE' | 'CONNECTING' | 'GREETING' | 'CONVERSATION'` to:

```typescript
type CallState = 'INACTIVE' | 'CONNECTING' | 'LIVE';
```

- [ ] **Step 3: Replace the client refs**

Remove `realtimeRef`, `avatarRef`, `avatarStreamRef`, `greetingFallbackTimer`, `isMutedRef`. Add:

```typescript
const roomRef = useRef<RoomClient | null>(null);
const avatarVideoRef = useRef<HTMLVideoElement | null>(null);
const pendingStreamRef = useRef<MediaStream | null>(null);
```

`pendingStreamRef` exists because `onAvatarVideo` fires inside the room subscribe callback, which can run before `state === 'LIVE'` has rendered the `<video>` element. The effect below applies it once the element mounts.

- [ ] **Step 4: Replace `handleStartCall`**

```typescript
const handleStartCall = async () => {
  if (state !== 'INACTIVE') return;
  setState('CONNECTING');
  setLiveUserCaption('');
  setLiveAssistantCaption('');

  const room = new RoomClient({
    onAvatarVideo: (stream) => {
      pendingStreamRef.current = stream;
      if (avatarVideoRef.current) {
        avatarVideoRef.current.srcObject = stream;
        void avatarVideoRef.current.play().catch(() => {});
      }
    },
    onAvatarAudible: () => {
      // The moment we know audio is on the user's speakers — drop the overlay.
      setState((prev) => (prev === 'CONNECTING' ? 'LIVE' : prev));
    },
    onTranscript: (text, role, final) => {
      if (role === 'user') {
        setLiveUserCaption(text);
        if (final) appendTranscript({ role: 'user', text });
      } else {
        setLiveAssistantCaption(text);
        if (final) appendTranscript({ role: 'assistant', text });
      }
    },
    onDisconnected: () => handleEndCall(),
    onError: (err) => {
      console.error(err);
      handleEndCall();
    },
  });
  roomRef.current = room;

  try {
    await room.start(backendBase);
  } catch (err) {
    console.error(err);
    await handleEndCall();
  }
};
```

- [ ] **Step 5: Replace `handleEndCall`**

```typescript
const handleEndCall = async () => {
  try { await roomRef.current?.stop(); } catch {}
  roomRef.current = null;
  pendingStreamRef.current = null;
  if (avatarVideoRef.current) avatarVideoRef.current.srcObject = null;
  setState('INACTIVE');
  setLiveUserCaption('');
  setLiveAssistantCaption('');
};
```

- [ ] **Step 6: Replace `toggleMute`**

```typescript
const toggleMute = () => {
  setMuted((prev) => {
    const next = !prev;
    roomRef.current?.setMicMuted(next);
    return next;
  });
};
```

- [ ] **Step 7: Add the video-stream-apply effect**

Place near the other `useEffect`s:

```typescript
useEffect(() => {
  if (state === 'LIVE' && avatarVideoRef.current && pendingStreamRef.current) {
    avatarVideoRef.current.srcObject = pendingStreamRef.current;
    void avatarVideoRef.current.play().catch(() => {});
  }
}, [state]);
```

- [ ] **Step 8: Update conditional rendering**

- Lobby is shown when `state === 'INACTIVE'`.
- Call view is shown when `state === 'CONNECTING'` or `state === 'LIVE'`.
- Connecting overlay is shown only when `state === 'CONNECTING'`.
- Status pill is `good` when `state === 'LIVE'`.
- Captions block: `const showCaptions = state === 'LIVE' && captionsOn && captionsVisible && (liveAssistantCaption || liveUserCaption);`

- [ ] **Step 9: Remove dead imports**

Delete imports of `OpenAIRealtimeClient`, `LiveAvatarLiteClient`. Add:

```typescript
import { RoomClient } from './livekit/RoomClient';
```

- [ ] **Step 10: Type-check**

```bash
npx tsc -b --noEmit
```

Expected: clean. Fix any remaining references to removed types.

- [ ] **Step 11: Commit**

```bash
git add src/App.tsx
git commit -m "feat(client): rewrite App around single LiveKit Room"
```

---

## Task 7: End-to-end smoke test

This is the gate that proves the migration succeeded. Three processes must run together.

- [ ] **Step 1: Start the agent worker**

Terminal A:

```bash
cd agent
source .venv/bin/activate    # Windows: .venv\Scripts\Activate.ps1
python worker.py dev
```

Expected: `registered worker` log line, then the worker waits.

- [ ] **Step 2: Start the Node token server**

Terminal B:

```bash
npm run server
```

Expected: `Auth proxy listening on http://localhost:3000` and `POST /api/livekit-token` log line.

- [ ] **Step 3: Start the Vite client**

Terminal C:

```bash
npm run client
```

Expected: `Local: http://localhost:5173/` (or whatever port Vite picks).

- [ ] **Step 4: Test the golden path**

Open the Vite URL in a browser. Click **Start Call**.

Expected observable behavior:
1. Connecting overlay shows for ~1–3 seconds (LiveKit handshake + avatar bot joining).
2. Avatar video appears.
3. **Within ~200ms of the video appearing, the avatar starts speaking the greeting** — this is the core success criterion. There must NOT be a 3–4 second silent-avatar gap.
4. Lip sync is tight (audio and video originate from the same LiveKit participant).
5. Speak: "Hello, what are your clinic hours?" — VAD picks it up, the avatar interrupts gracefully, generates a response, responds.
6. Click mute. Speak — no response is generated, no echo.
7. Unmute. Conversation resumes.
8. Click end-call — both sides disconnect cleanly.

In Terminal A you should see logs from the worker for each turn (LLM call, audio frames, transcription).

- [ ] **Step 5: If the greeting is still delayed**

Likely cause: `avatar.start()` is resolving before the avatar bot has actually published its tracks. Confirm by watching Terminal A for the avatar bot's `participant connected` event before `generate_reply` is called. If `generate_reply` fires too early, file an upstream issue against `livekit-plugins-liveavatar` — the documented contract is that `avatar.start()` only resolves after the avatar participant is fully ready. As a workaround, await `room.localParticipant.waitForTrackSubscriptions()` or listen for `RoomEvent.TrackSubscribed` of an audio track from the avatar's identity before calling `generate_reply`.

- [ ] **Step 6: Commit any fixes**

If the smoke test passed unchanged, skip. Otherwise:

```bash
git add -A
git commit -m "fix(agent): <describe>"
```

---

## Task 8: Delete the old PCM bridge

**Files:**
- Delete: `src/avatar/liveAvatarLite.ts`
- Delete: `src/realtime/openaiRealtime.ts`
- Delete: `public/pcm-tap.worklet.js`
- Delete: `api/realtime-token.js`
- Delete: `api/avatar-session.js`
- Modify: `package.json` (drop `node-fetch` if no longer used)

- [ ] **Step 1: Verify no remaining references**

```bash
grep -r "liveAvatarLite\|openaiRealtime\|pcm-tap\|avatar-session\|realtime-token" src api server.js
```

Expected: no matches.

- [ ] **Step 2: Delete the files**

```bash
git rm src/avatar/liveAvatarLite.ts
git rm src/realtime/openaiRealtime.ts
git rm public/pcm-tap.worklet.js
git rm api/realtime-token.js
git rm api/avatar-session.js
```

If the resulting `src/avatar/` and `src/realtime/` directories are empty, leave them (git won't track them anyway).

- [ ] **Step 3: Check whether `node-fetch` is still used**

```bash
grep -r "node-fetch" src api server.js
```

If no matches, remove the dep:

```bash
npm uninstall node-fetch
```

- [ ] **Step 4: Type-check and run tests one more time**

```bash
npx tsc -b --noEmit && npm test
```

Expected: clean.

- [ ] **Step 5: Re-run the end-to-end smoke from Task 7 Step 4**

Same observable behavior. If it still works, the dead code really was dead.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: delete browser-side PCM bridge — replaced by LiveKit Agents"
```

---

## Task 9: Production deployment notes

**Files:**
- Modify: `agent/README.md`
- Modify: `docs/superpowers/plans/2026-05-25-livekit-agents-migration.md` (this file — add deployment outcome)

- [ ] **Step 1: Decide where the worker runs**

Three viable options:

1. **LiveKit Cloud Agents** (managed) — push the worker repo, LiveKit runs it as a serverless job per room. Easiest. Use `livekit-cli agent create` and `livekit-cli agent deploy`. See https://docs.livekit.io/agents/ops/deployment/.
2. **Fly.io / Render / Railway** — long-running container. Cheapest if you already use one. Dockerfile: `FROM python:3.11-slim`, `COPY agent/`, `pip install -r requirements.txt`, `CMD ["python", "worker.py", "start"]`.
3. **Vercel** — NOT viable for the worker (it's a persistent process, not a request handler). Vercel keeps hosting the Vite build and the `api/livekit-token.js` serverless function.

Pick the one that matches your existing ops surface. For this project (already on Vercel for the frontend), option 1 (LiveKit Cloud Agents) is the least new infra.

- [ ] **Step 2: Set production env vars**

Wherever the worker runs, set: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEAVATAR_API_KEY`, `LIVEAVATAR_AVATAR_ID`, `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`.

On Vercel (for the frontend + token endpoint), set: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Nothing else — the frontend never sees the OpenAI or HeyGen keys, which is a security win over the old architecture.

- [ ] **Step 3: Update `agent/README.md`** with the chosen deployment path's exact commands once decided.

- [ ] **Step 4: Smoke-test production**

Hit the deployed URL, click Start Call, verify the same observable behavior from Task 7 Step 4.

- [ ] **Step 5: Commit**

```bash
git add agent/README.md docs/superpowers/plans/2026-05-25-livekit-agents-migration.md
git commit -m "docs: deployment notes for LiveKit Agents worker"
```

---

## Rollback plan

If anything goes wrong mid-migration, the old architecture is preserved on `master`. Worst case:

```bash
git switch master
```

The old `liveAvatarLite.ts` / `openaiRealtime.ts` / PCM-tap pipeline is intact there. The branch this plan executes on is fully self-contained until Task 8 deletes the old files — and even then, `git revert` restores them.
