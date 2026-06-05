# Agent worker

A LiveKit Agents worker running a discrete speech pipeline:

- **STT** — OpenAI `gpt-4o-transcribe`
- **LLM** — OpenAI `gpt-4o-mini` (driven by `prompt.py`)
- **TTS** — ElevenLabs `eleven_turbo_v2_5` (with SSML pause parsing)
- **VAD** — Silero
- **Avatar** — HeyGen LiveAvatar (video + lip-sync)

## Local dev

    cd apps/agent
    python -m venv .venv
    source .venv/bin/activate    # Windows: .venv\Scripts\Activate.ps1
    pip install -r requirements.txt
    python worker.py dev

Credentials come from the shared `env/.env.${APP_ENV}` file at the repo root
(`APP_ENV` defaults to `dev`) — see the root README for setup.

`dev` mode runs the worker in foreground and auto-reloads on file changes.

## Production

Run `python worker.py start` with `APP_ENV=prod` set (exported once in the
box's shell profile) so it loads `env/.env.prod`. The process must stay alive —
deploy as a long-running service (systemd unit, pm2, or any process manager).
On the current prod box it runs directly in its venv on the same host as nginx
and the token server.
