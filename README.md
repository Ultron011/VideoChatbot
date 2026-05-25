# Dr. Malpani AI Nurse — Live Video Avatar

Real-time video call app where users talk to an AI nurse avatar for Dr. Malpani's IVF clinic. Built on LiveKit Agents with HeyGen LiveAvatar for video/lip-sync and OpenAI Realtime as the conversational model.

## Architecture

```
Browser (React + livekit-client)
        │
        ▼
LiveKit Cloud room ───────── Avatar bot (publishes synced A/V)
        ▲                              ▲
        │                              │
Node token endpoint            Python agent worker
(api/livekit-token.js)         (agent/worker.py)
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                    OpenAI Realtime  OpenAI TTS  HeyGen LiveAvatar
                    (conversation)   (greeting)  (video + lip-sync)
```

Everything except the browser runs server-side. The browser is a thin LiveKit room participant that joins, subscribes to the avatar's audio + video tracks, and publishes the user's mic.

## Running locally

You'll need **three processes** in three terminals.

### Prerequisites (one-time)

1. **Node deps:**
   ```sh
   npm install
   ```

2. **Python deps:**
   ```sh
   cd agent
   python -m venv .venv
   .venv\Scripts\Activate.ps1     # Windows PowerShell
   # source .venv/bin/activate    # macOS/Linux
   pip install -r requirements.txt
   ```

3. **Env vars** — copy the example files and fill in your keys:
   ```sh
   cp .env.example .env                  # root: LiveKit creds only
   cp agent/.env.example agent/.env      # worker: LiveKit + HeyGen + OpenAI
   ```

   Where to get the values:
   - **LiveKit** — https://cloud.livekit.io → create project → Settings → Keys → copy URL / API Key / Secret into both `.env` files.
   - **HeyGen LiveAvatar** — https://app.liveavatar.com → API key → paste into `agent/.env` as `LIVEAVATAR_API_KEY`.
   - **OpenAI** — https://platform.openai.com/api-keys → paste into `agent/.env` as `OPENAI_API_KEY`.

### Start the call (three terminals)

**Terminal A — Python agent worker:**
```sh
cd agent
.venv\Scripts\Activate.ps1
python worker.py dev
```
Waits for `registered worker` log line.

**Terminal B — Node token endpoint:**
```sh
npm run server
```
Listens on `http://localhost:3000`.

**Terminal C — Vite dev server:**
```sh
npm run client
```
Opens at `http://localhost:5173`.

Open the Vite URL and click **Join now**. The avatar greets within ~200ms of appearing, then you can talk to it.

### Combined dev script (Node + Vite in one terminal)

If you'd rather run Node and Vite together, use:
```sh
npm run dev
```
You still need to start the Python worker separately in another terminal.

## Project layout

```
agent/                  Python LiveKit Agents worker (OpenAI + HeyGen)
api/                    Serverless functions (LiveKit token mint)
public/                 Static assets
src/
├── App.tsx             State machine + shell
├── components/         Lobby, CallView, Captions, StatusPill
├── hooks/              useLocalCamera
├── lib/                RoomClient (livekit-client wrapper)
└── main.tsx, index.css
docs/                   Plans + specs (historical record)
server.js               Dev-only Express wrapping api/
```

## Testing

```sh
npm test                # Vitest — covers the token endpoint
npx tsc -b --noEmit     # Type-check
```

## Notes

- HeyGen LiveAvatar consumes credits per session-minute regardless of whether you use the public sandbox avatar (`dd73ea75-…`) or your own custom one. The "public" label means "every API key can use it," not "free."
- The greeting is pre-synthesized once when the worker process starts (`prewarm_fnc` in `agent/worker.py`) and streamed as cached PCM at call time — no LLM or TTS round-trip when the user clicks Join.
- Lip sync is tight because audio and video both come from the same LiveKit participant (the avatar bot). The old browser-side PCM bridge is gone — see `docs/superpowers/plans/2026-05-25-livekit-agents-migration.md` for the migration history.
