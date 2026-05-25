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
