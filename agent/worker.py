import os
from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import Agent, AgentSession, JobContext, JobProcess, WorkerOptions, cli
from livekit.plugins import openai, liveavatar, silero

from prompt import SYSTEM_PROMPT

load_dotenv()

GREETING = "Hi! I'm Dr. Malpani's AI nurse — how can I help you today?"

# 24kHz mono 16-bit PCM, 20ms per frame.
GREETING_SAMPLE_RATE = 24000
GREETING_SAMPLES_PER_FRAME = 480  # 20ms @ 24kHz
GREETING_BYTES_PER_FRAME = GREETING_SAMPLES_PER_FRAME * 2  # int16


def prewarm(proc: JobProcess) -> None:
    """Synthesize the greeting once when the worker process starts so
    the first user pays zero TTS latency on Start Call."""
    from openai import OpenAI

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    resp = client.audio.speech.create(
        model="gpt-4o-mini-tts",
        voice=os.environ.get("OPENAI_REALTIME_VOICE", "alloy"),
        input=GREETING,
        response_format="pcm",  # raw 16-bit PCM @ 24kHz mono
    )
    proc.userdata["greeting_pcm"] = resp.read()


async def _cached_greeting_frames(pcm: bytes):
    """Yield AudioFrames sliced from the cached PCM at real-time pace."""
    for i in range(0, len(pcm), GREETING_BYTES_PER_FRAME):
        chunk = pcm[i : i + GREETING_BYTES_PER_FRAME]
        if not chunk:
            break
        # Pad the final frame so samples_per_channel matches exactly.
        if len(chunk) < GREETING_BYTES_PER_FRAME:
            chunk = chunk + b"\x00" * (GREETING_BYTES_PER_FRAME - len(chunk))
        yield rtc.AudioFrame(
            data=chunk,
            sample_rate=GREETING_SAMPLE_RATE,
            num_channels=1,
            samples_per_channel=GREETING_SAMPLES_PER_FRAME,
        )


class DrMalpaniNurse(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    voice = os.environ.get("OPENAI_REALTIME_VOICE", "alloy")
    session = AgentSession(
        llm=openai.realtime.RealtimeModel(
            model=os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2025-08-28"),
            voice=voice,
            temperature=0.7,
        ),
        # TTS is only kept as a safety fallback for session.say(); the cached
        # greeting bypasses it entirely by passing audio= directly.
        tts=openai.TTS(voice=voice),
        vad=silero.VAD.load(),
    )

    avatar = liveavatar.AvatarSession(
        avatar_id=os.environ["LIVEAVATAR_AVATAR_ID"],
    )

    await avatar.start(session, room=ctx.room)

    await session.start(
        agent=DrMalpaniNurse(),
        room=ctx.room,
    )

    # Stream the pre-cached greeting PCM directly to the avatar pipeline.
    # No LLM, no TTS call at greet time — the only remaining latency is
    # the network hop into LiveAvatar's lip-sync engine.
    pcm = ctx.proc.userdata["greeting_pcm"]
    await session.say(
        GREETING,
        audio=_cached_greeting_frames(pcm),
        allow_interruptions=True,
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm))
