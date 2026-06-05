"""Pronunciation layer.

Word→respelling rules live in data/pronunciation.json (e.g. "ICSI" →
"I.C.S.I.", "Malpani" → "Mahl-pah-nee"). They are applied as a TTS text
transform — the synthesizer speaks the respelling while captions keep the
original spelling, because transcription forwarding uses the pre-transform
text.

Alias respellings are used instead of SSML phoneme tags because ElevenLabs
flash/turbo v2.5 models silently ignore phoneme tags.
"""

import json
import logging

from livekit.agents import text_transforms

from .config import PRONUNCIATION_FILE

logger = logging.getLogger("pronunciation")


def build_tts_transforms() -> list:
    """TTS text transforms: markdown/emoji filters + pronunciation rules."""
    transforms: list = ["filter_markdown", "filter_emoji"]

    rules: dict[str, str] = {}
    if PRONUNCIATION_FILE.exists():
        try:
            with open(PRONUNCIATION_FILE, "r", encoding="utf-8") as f:
                rules = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load pronunciation rules: {e}")

    if rules:
        transforms.append(text_transforms.replace(rules))
    return transforms
