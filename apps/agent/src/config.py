"""Environment, paths, and tunables — import this before anything that
reads os.environ: importing it loads env/.env.${APP_ENV} into the process.

Shared per-environment credentials live in env/.env.${APP_ENV} at the repo
root. APP_ENV defaults to "dev"; the prod box exports APP_ENV=prod once.
(Note: APP_ENV picks credentials; `python agent.py dev|start` picks the
worker mode — they are unrelated.)
"""

import os
from pathlib import Path

from dotenv import load_dotenv

AGENT_DIR = Path(__file__).resolve().parents[1]  # apps/agent
REPO_ROOT = AGENT_DIR.parents[1]

APP_ENV = os.getenv("APP_ENV", "dev")
ENV_FILE = REPO_ROOT / "env" / f".env.{APP_ENV}"
if not ENV_FILE.exists():
    raise FileNotFoundError(
        f'Missing env file for APP_ENV="{APP_ENV}": {ENV_FILE}. '
        "Copy env/.env.example to env/.env.dev (or env/.env.prod) and fill in values."
    )
load_dotenv(ENV_FILE)

# The worker registers under an explicit name (ai-twin-dev / ai-twin-prod by
# default), which disables auto-dispatch: the token server requests this agent
# by name for every room it mints a token for (RoomAgentDispatch).
AGENT_NAME = os.getenv("AGENT_NAME", f"ai-twin-{APP_ENV}")

# --- Data & cache paths ----------------------------------------------------

DATA_DIR = AGENT_DIR / "data"
KB_DIR = DATA_DIR / "kb"                              # knowledge base markdown
CACHE_FILE = DATA_DIR / "cache.json"                  # curated FAQ answers
PRONUNCIATION_FILE = DATA_DIR / "pronunciation.json"  # TTS replacements
AUDIO_CACHE_DIR = AGENT_DIR / ".cache" / "audio"      # generated audio (gitignored)

# --- Voice & conversation tunables ------------------------------------------

GREETING = "Hi! I'm the AI assistant at Dr. Malpani's clinic — how can I help you today?"

TTS_MODEL = "eleven_flash_v2_5"

# Instant acknowledgments played from pre-rendered audio the moment the
# user's turn ends (cache misses only — cached answers are already
# near-instant). They mask the LLM + TTS + avatar latency: the agent reacts
# within ~1s while the real answer streams in behind.
#
# Keep them as thinking-style backchannels ("Hmm...", "Achha..."), the way
# an Indian counsellor naturally murmurs while considering — a pause after
# these feels like thinking. Avoid promissory phrases ("give me a moment"):
# they make the remaining silence feel like a stall. Trailing ellipses give
# the TTS a trailing-off, thoughtful tone.
FILLERS_EN = [
    "Hmm...",
    "Achha...",
    "Hmm, right...",
    "Haan, okay...",
]
FILLERS_HI = [
    "हम्म...",
    "अच्छा...",
    "जी...",
]
