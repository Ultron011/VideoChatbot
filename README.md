# Dr. Malpani AI Nurse — Live Video Avatar

Real-time video call app where users talk to an AI nurse avatar for Dr.
Malpani's IVF clinic. Built on LiveKit Agents with HeyGen LiveAvatar for
video/lip-sync, OpenAI for speech-to-text and the conversational model, and
ElevenLabs for the voice.

## Architecture

```
Browser (React + livekit-client)              apps/web
        │
        ▼
LiveKit Cloud room ───────── Avatar bot (publishes synced A/V)
        ▲                              ▲
        │                              │
Token server (Express)          Python agent worker
apps/token-server               apps/agent
        │                              │
   mints LiveKit       ┌───────────────┼───────────────────┐
   JWT (15m TTL)       ▼               ▼                   ▼
                  OpenAI STT       OpenAI LLM         ElevenLabs TTS ─► HeyGen
                gpt-4o-transcribe  gpt-4o-mini        eleven_turbo_v2_5  LiveAvatar
```

Everything except the browser runs server-side. The browser is a thin LiveKit
room participant: it joins, subscribes to the avatar's audio + video tracks, and
publishes the user's mic. The token server exists solely to mint LiveKit JWTs —
the signing secret must never reach the browser.

## Monorepo layout

```
apps/
├── web/            React + Vite frontend (built static, served by nginx)
├── token-server/   Express service that mints LiveKit JWTs (binds 127.0.0.1)
└── agent/          Python LiveKit Agents worker (STT → LLM → TTS + avatar)
env/                Shared per-environment credentials (.env.dev / .env.prod, gitignored)
docs/               Plans + specs (local-only, gitignored)
```

`apps/web` and `apps/token-server` are npm workspaces (one `npm install` at the
root). `apps/agent` is an independent Python project with its own virtualenv.

## Running locally

You need **three processes**. The agent runs on its own; the web app and token
server run together via the root `dev` script.

### Prerequisites (one-time)

1. **Node deps** (installs both JS workspaces):
   ```sh
   npm install
   ```

2. **Python deps:**
   ```sh
   cd apps/agent
   python -m venv .venv
   .venv\Scripts\Activate.ps1     # Windows PowerShell
   # source .venv/bin/activate    # macOS/Linux
   pip install -r requirements.txt
   python -m livekit.agents download-files
   ```
   The last step downloads the end-of-turn detector model weights (and Silero
   VAD). It is REQUIRED on every machine (dev and prod) after installing or
   upgrading the plugins — without it the worker crashes at the first user
   turn with `'_EUORunnerMultilingual' object has no attribute '_tokenizer'`.

3. **Env vars** — ONE shared file per environment, read by both the token
   server and the agent worker:
   ```sh
   cp env/.env.example env/.env.dev    # fill in your keys
   ```
   `APP_ENV` picks the file (`env/.env.${APP_ENV}`) and **defaults to `dev`**,
   so on a dev machine you set nothing. The real `.env.dev` / `.env.prod` are
   gitignored — credentials never enter git.

   Where to get the values:
   - **LiveKit** — https://cloud.livekit.io → create project → Settings → Keys
     (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`).
   - **HeyGen LiveAvatar** — https://app.liveavatar.com → API key →
     `LIVEAVATAR_API_KEY`.
   - **OpenAI** — https://platform.openai.com/api-keys → `OPENAI_API_KEY`.
   - **ElevenLabs** — https://elevenlabs.io → API key + a voice id →
     `ELEVEN_API_KEY` and `ELEVENLABS_VOICE_ID`.

### Start the call

**Terminal A — Python agent worker:**
```sh
cd apps/agent
.venv\Scripts\Activate.ps1
python agent.py dev
```
Wait for the `registered worker` log line.

**Terminal B — token server + web (from repo root):**
```sh
npm run dev
```
Runs the Express token server (`http://localhost:3000`) and the Vite dev server
(`http://localhost:5173`) together. Vite proxies `/api` to the token server, so
the browser stays same-origin in dev exactly as it does behind nginx in prod —
CORS never applies locally.

Open the Vite URL and click **Join now**. The avatar greets shortly after
appearing, then you can talk to it.

> Prefer separate terminals? Use `npm run dev:server` and `npm run dev:web`.

## Building & deploying

One-time setup on the prod box:
```sh
cp env/.env.example env/.env.prod    # fill in prod values, incl. ALLOWED_ORIGIN
echo 'export APP_ENV=prod' >> ~/.bashrc && source ~/.bashrc
```

Then per deploy:
- `npm run build` → builds the frontend to **`apps/web/dist`** (point nginx's
  web root here).
- Token server: `npm run start -w apps/token-server`. The env file is resolved
  relative to the source (`env/.env.${APP_ENV}`), so the working directory no
  longer matters.
- Agent: `cd apps/agent && python agent.py start` (long-running; keep it alive
  with systemd/pm2). `APP_ENV` picks credentials; the `dev|start` subcommand
  picks the worker mode — they're unrelated. After any
  `pip install -r requirements.txt`, run `python -m livekit.agents
  download-files` once before starting (turn-detector model weights).

## Testing

```sh
npm test                          # Vitest — covers the token-mint function
cd apps/web && npx tsc -b --noEmit # Type-check the frontend
npm run lint                      # ESLint the frontend
```

## Notes

- HeyGen LiveAvatar consumes credits per session-minute regardless of whether
  you use the public sandbox avatar (`dd73ea75-…`) or your own custom one. The
  "public" label means "every API key can use it," not "free."
- The greeting is a fixed line spoken live via `session.say()` at call time. The
  browser keeps the mic muted until the worker publishes a `greeting_done` data
  message (with a 15s safety unlatch), so the user can't talk over the greeting.
- Lip sync is tight because audio and video both come from the same LiveKit
  participant (the avatar bot).
- The agent worker registers under an explicit name — `ai-twin-dev` /
  `ai-twin-prod`, derived from `APP_ENV` (override with `AGENT_NAME`) — and the
  token server dispatches it by name into each room. Side effect: rooms created
  outside the app (e.g. the LiveKit dashboard playground) won't auto-receive
  the agent; add the agent name there manually if needed.
