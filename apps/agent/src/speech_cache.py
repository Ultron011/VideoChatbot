"""Speech cache layer: pre-rendered audio for fixed phrases.

Fixed texts (the greeting, filler acknowledgments) have their TTS audio
rendered once and replayed from disk afterwards — removing the ElevenLabs
round-trip from the connect path and from turn-end reactions. The cache key
includes the text, voice and model, so editing any of them simply renders a
fresh file on the next call.

Flow (see core.py):
    frames = speech_cache.load(GREETING, voice_id, model)
    if frames is not None:
        session.say(GREETING, audio=frames)     # instant, from disk
    else:
        session.say(GREETING)                   # first run: live TTS
        speech_cache.schedule_render(...)       # populate for next time
"""

import asyncio
import hashlib
import logging
import wave
from collections.abc import AsyncIterable
from pathlib import Path

from livekit import rtc

from .config import AUDIO_CACHE_DIR

logger = logging.getLogger("speech-cache")

CACHE_DIR = AUDIO_CACHE_DIR
_FRAME_MS = 100


def _cache_path(text: str, voice_id: str, model: str) -> Path:
    key = hashlib.sha256(f"{model}|{voice_id}|{text}".encode()).hexdigest()[:16]
    return CACHE_DIR / f"greeting-{key}.wav"


def load(text: str, voice_id: str, model: str) -> AsyncIterable[rtc.AudioFrame] | None:
    """Return an AudioFrame stream for session.say(audio=...), or None if
    the greeting hasn't been rendered yet."""
    path = _cache_path(text, voice_id, model)
    if not path.exists():
        return None

    async def _frames() -> AsyncIterable[rtc.AudioFrame]:
        with wave.open(str(path), "rb") as w:
            sample_rate = w.getframerate()
            num_channels = w.getnchannels()
            samples_per_frame = sample_rate * _FRAME_MS // 1000
            while True:
                data = w.readframes(samples_per_frame)
                if not data:
                    break
                yield rtc.AudioFrame(
                    data=data,
                    sample_rate=sample_rate,
                    num_channels=num_channels,
                    samples_per_channel=len(data) // (2 * num_channels),
                )

    return _frames()


def schedule_render(text: str, tts, voice_id: str, model: str) -> None:
    """Render and persist the greeting in the background (first run only)."""
    path = _cache_path(text, voice_id, model)
    if path.exists():
        return

    async def _render() -> None:
        try:
            frames: list[rtc.AudioFrame] = []
            async for ev in tts.synthesize(text):
                frames.append(ev.frame)
            if not frames:
                logger.warning("greeting render produced no audio")
                return
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            with wave.open(str(tmp), "wb") as w:
                w.setnchannels(frames[0].num_channels)
                w.setsampwidth(2)  # 16-bit PCM
                w.setframerate(frames[0].sample_rate)
                for f in frames:
                    w.writeframes(f.data.tobytes())
            tmp.replace(path)
            logger.info(f"greeting audio cached: {path.name}")
        except Exception as e:
            logger.warning(f"failed to cache greeting audio: {e}")

    asyncio.create_task(_render())
