"""Core layer: the agent definition and the session pipeline.

DrMalpaniNurse wires the layers together per call:
    STT (Deepgram nova-3, multi) → memory cache / LLM (gpt-4o-mini)
    → pronunciation transforms → TTS (ElevenLabs flash v2.5)
    → HeyGen avatar (src/avatar.py)
with the multilingual turn-detector model + preemptive generation for
latency, pre-rendered greeting/filler audio (src/speech_cache.py), and
SSML-free caption forwarding.
"""

import json
import logging
import os
import random
import re
import time
from collections.abc import AsyncGenerator, AsyncIterable

from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    JobProcess,
    MetricsCollectedEvent,
    ModelSettings,
    metrics,
)
from livekit.plugins import deepgram, openai, elevenlabs, silero
from livekit.plugins.elevenlabs import VoiceSettings
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from . import avatar as liveavatar
from . import speech_cache
from .config import CACHE_FILE, FILLERS_EN, FILLERS_HI, GREETING, TTS_MODEL
from .memory import CachedLLM, CachingManager, has_devanagari
from .pronunciation import build_tts_transforms
from .prompts import build_system_prompt

logger = logging.getLogger("ai-twin")

# Matches complete SSML/markup tags, e.g. <break time="0.4s"/>.
_TAG_RE = re.compile(r"<[^>]*>")


class DrMalpaniNurse(Agent):
    def __init__(
        self,
        instructions: str,
        *,
        caching_manager: CachingManager | None = None,
        tts=None,
        voice_id: str | None = None,
    ) -> None:
        super().__init__(instructions=instructions)
        self._caching_manager = caching_manager
        self._filler_tts = tts
        self._voice_id = voice_id

    def prerender_fillers(self) -> None:
        """Render filler audio in the background (one-time; cached to disk)."""
        if self._filler_tts is None or self._voice_id is None:
            return
        for phrase in FILLERS_EN + FILLERS_HI:
            speech_cache.schedule_render(phrase, self._filler_tts, self._voice_id, TTS_MODEL)

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        # Play a pre-rendered acknowledgment immediately so the agent reacts
        # the moment the user stops, instead of staring while the LLM works.
        # add_to_chat_ctx=False keeps fillers out of the conversation history
        # (and off the LLM's prompt, preserving the prefix cache).
        if self._voice_id is None:
            return
        text = (new_message.text_content or "").strip()
        if not text:
            return
        if self._caching_manager and self._caching_manager.match_query(text):
            return  # cached answer plays near-instantly; a filler would drag it
        pool = FILLERS_HI if has_devanagari(text) else FILLERS_EN
        filler = random.choice(pool)
        audio = speech_cache.load(filler, self._voice_id, TTS_MODEL)
        if audio is not None:
            self.session.say(filler, audio=audio, add_to_chat_ctx=False)

    async def transcription_node(
        self,
        text: AsyncIterable[str],
        model_settings: ModelSettings,
    ) -> AsyncGenerator[str, None]:
        # Strip SSML tags (e.g. <break time="0.4s"/>) from the transcript
        # forwarded to captions while the TTS path keeps them for pacing.
        # Tags can be split across streaming chunks, so buffer from any
        # unclosed '<' until its '>' arrives.
        buf = ""
        async for chunk in text:
            buf += str(chunk)
            out: list[str] = []
            while True:
                lt = buf.find("<")
                if lt == -1:
                    out.append(buf)
                    buf = ""
                    break
                out.append(buf[:lt])
                gt = buf.find(">", lt)
                if gt == -1:
                    buf = buf[lt:]  # incomplete tag — wait for more text
                    break
                buf = buf[gt + 1 :]
            if cleaned := "".join(out):
                yield cleaned
        # Stream ended with a leftover '<...' fragment: drop complete tags,
        # keep anything that wasn't markup after all.
        if buf and (rest := _TAG_RE.sub("", buf)):
            yield rest


def prewarm(proc: JobProcess) -> None:
    # Runs once per worker process, before any job is assigned. Loading the
    # VAD here (instead of per-call in the entrypoint) removes ~2.5s from
    # every connect. min_silence_duration: how long the user must pause
    # before their turn can end; raise to 500ms if the agent interrupts
    # too eagerly.
    proc.userdata["vad"] = silero.VAD.load(min_silence_duration=0.3)


async def entrypoint(ctx: JobContext) -> None:
    # Connect-time instrumentation: every stage logs its elapsed-since-job
    # time so regressions in join latency are visible in the worker logs.
    t0 = time.monotonic()

    def mark(stage: str) -> None:
        logger.info("connect timing: %s at %.0f ms", stage, (time.monotonic() - t0) * 1000)

    await ctx.connect()
    mark("room connected")

    # System prompt = persona rules (prompts.py) + clinic knowledge
    # (data/kb/*.md). It is fully static: prompt_cache_key below pins OpenAI
    # prefix caching to it, cutting input latency/cost on every turn after
    # the first.
    system_prompt = build_system_prompt()

    # Memory layer: wrap openai.LLM so curated FAQ answers (data/cache.json)
    # short-circuit the model entirely.
    raw_llm = openai.LLM(model="gpt-4o-mini", prompt_cache_key="ai-twin-v1")
    cached_llm = CachedLLM(raw_llm, CACHE_FILE)

    voice_id = os.environ["ELEVENLABS_VOICE_ID"]
    tts = elevenlabs.TTS(
        model=TTS_MODEL,
        voice_id=voice_id,
        voice_settings=VoiceSettings(
            stability=0.35,
            similarity_boost=0.80,
            style=0.45,
            use_speaker_boost=True,
        ),
        enable_ssml_parsing=True,
        # Emit the first audio after 50 buffered chars (default 120) — the
        # voice starts sooner at a slight prosody cost on the first phrase.
        chunk_length_schedule=[50, 120, 200, 260],
        # The prompt already forces spoken-form numbers ("one lakh fifty
        # thousand rupees"), so ElevenLabs' normalization pass is pure
        # added latency.
        apply_text_normalization="off",
    )

    session = AgentSession(
        # Deepgram Nova-3 streams partial transcripts at sub-300ms latency
        # (vs the HTTP-based gpt-4o-transcribe). language="multi" enables
        # English+Hindi code-switching.
        stt=deepgram.STT(model="nova-3", language="multi"),
        llm=cached_llm,
        tts=tts,
        vad=ctx.proc.userdata["vad"],
        # Semantic end-of-turn model (English+Hindi): judges whether the
        # utterance is complete instead of relying on silence alone, which
        # lets the endpointing delay sit lower without cutting people off.
        turn_detection=MultilingualModel(),
        min_endpointing_delay=0.35,
        # Run the LLM speculatively on the partial transcript while the
        # turn-end is still being confirmed (default-on in 1.5.13; explicit
        # here because the response latency depends on it).
        preemptive_generation=True,
        tts_text_transforms=build_tts_transforms(),
    )
    mark("session created")

    # Per-turn latency metrics: EOU delay (turn detection), LLM TTFT, and
    # TTS TTFB together approximate the user-perceived response delay.
    usage = metrics.UsageCollector()

    @session.on("metrics_collected")
    def _on_metrics_collected(ev: MetricsCollectedEvent) -> None:
        metrics.log_metrics(ev.metrics)
        usage.collect(ev.metrics)

    async def _log_usage_summary() -> None:
        logger.info("usage summary: %s", usage.get_summary())

    ctx.add_shutdown_callback(_log_usage_summary)

    avatar = liveavatar.AvatarSession(
        avatar_id=os.environ["LIVEAVATAR_AVATAR_ID"],
    )

    await avatar.start(session, room=ctx.room)
    mark("avatar started")

    agent = DrMalpaniNurse(
        instructions=system_prompt,
        caching_manager=cached_llm.caching_manager,
        tts=tts,
        voice_id=voice_id,
    )
    await session.start(agent=agent, room=ctx.room)
    mark("agent session started")

    # The greeting is fixed text: replay pre-rendered audio from disk when
    # available (skips the TTS round-trip); render it in the background on
    # the very first run.
    greeting_audio = speech_cache.load(GREETING, voice_id, TTS_MODEL)
    if greeting_audio is not None:
        mark("greeting starting (cached audio)")
        await session.say(GREETING, audio=greeting_audio, allow_interruptions=False)
    else:
        mark("greeting starting (live TTS)")
        await session.say(GREETING, allow_interruptions=False)
        speech_cache.schedule_render(GREETING, tts, voice_id, TTS_MODEL)
    mark("greeting finished")

    await ctx.room.local_participant.publish_data(
        payload=json.dumps({"type": "greeting_done"}).encode(),
        reliable=True,
        topic="control",
    )

    # Render filler acknowledgments after the connect path is done — they're
    # one-time (cached to disk) and must not compete with the greeting.
    agent.prerender_fillers()
