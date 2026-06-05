# Agent worker

A LiveKit Agents worker running a discrete speech pipeline:

- **STT** — Deepgram `nova-3` (streaming, English+Hindi via `language="multi"`)
- **LLM** — OpenAI `gpt-4o-mini` (static prompt prefix → OpenAI prompt caching),
  fronted by a curated FAQ answer cache that skips the model entirely
- **TTS** — ElevenLabs `eleven_flash_v2_5` (SSML pause parsing, pronunciation
  replacements, tuned first-chunk schedule)
- **Turn detection** — Silero VAD + LiveKit multilingual end-of-turn model,
  with preemptive generation
- **Avatar** — HeyGen LiveAvatar (video + lip-sync; patched fork with paced
  audio forwarding so barge-in interrupts actually stop playback)

## Layout

    agent.py              entry point (python agent.py dev|start)
    src/                  logic, one module per layer
      config.py           environment, paths, tunables (greeting, fillers)
      core.py             agent definition + session pipeline (entrypoint)
      memory.py           FAQ answer cache that short-circuits the LLM
      knowledge.py        knowledge base loader
      prompts.py          system prompt assembly (persona + knowledge)
      pronunciation.py    TTS pronunciation replacements
      speech_cache.py     pre-rendered audio (greeting, fillers)
      avatar.py           HeyGen LiveAvatar session (patched fork)
    data/                 editable data — no code
      kb/*.md             knowledge base (clinic info, costs, FAQs, ...)
      cache.json          curated FAQ answers + accepted phrasings
      pronunciation.json  word → spoken-form respellings
    tests/                offline test suites (no API keys needed)
    .cache/               generated audio cache (gitignored)

To teach the agent new facts, edit `data/kb/*.md` (or add a new numbered
file). To make a frequent question instant, add a group to `data/cache.json`
— more phrasings per group = better recall. To fix a mispronunciation, add a
respelling to `data/pronunciation.json`.

## Local dev

    cd apps/agent
    python -m venv .venv
    source .venv/bin/activate    # Windows: .venv\Scripts\Activate.ps1
    pip install -r requirements.txt
    python -m livekit.agents download-files   # turn-detector + VAD weights
    python agent.py dev

Credentials come from the shared `env/.env.${APP_ENV}` file at the repo root
(`APP_ENV` defaults to `dev`) — see the root README for setup.

`dev` mode runs the worker in foreground and auto-reloads on file changes.

## Tests

    python tests/test_caching.py              # memory-layer safety gates
    python tests/test_transcription_strip.py  # SSML-free captions

## Production

Run `python agent.py start` with `APP_ENV=prod` set (exported once in the
box's shell profile) so it loads `env/.env.prod`. The process must stay alive —
deploy as a long-running service (systemd unit, pm2, or any process manager).
On the current prod box it runs directly in its venv on the same host as nginx
and the token server. After any `pip install -r requirements.txt`, run
`python -m livekit.agents download-files` once before starting.
