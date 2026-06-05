"""AI Twin agent worker — entry point.

Usage:
    python agent.py dev      # local dev (auto-reload)
    python agent.py start    # production (long-running)

All logic lives in src/, one module per layer:
    src/config.py         environment, paths, tunables
    src/core.py           agent definition + session pipeline (entrypoint)
    src/memory.py         curated FAQ answer cache (LLM short-circuit)
    src/knowledge.py      knowledge base loader (data/kb/*.md)
    src/prompts.py        system prompt assembly
    src/pronunciation.py  TTS pronunciation replacements
    src/speech_cache.py   pre-rendered audio (greeting, fillers)
    src/avatar.py         HeyGen LiveAvatar session (patched fork)

Editable data lives in data/ (kb markdown, cache.json, pronunciation.json);
tests live in tests/.
"""

from livekit.agents import WorkerOptions, cli

from src.config import AGENT_NAME
from src.core import entrypoint, prewarm

if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=AGENT_NAME,
            prewarm_fnc=prewarm,
            # Keep one fully prewarmed process/runner idle so a new call
            # never waits for spawn + model load ("no warmed process
            # available for job" in the logs).
            num_idle_processes=1,
        )
    )
