import os
from dotenv import load_dotenv
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import openai, liveavatar, silero

from prompt import SYSTEM_PROMPT

load_dotenv()

GREETING = "Hi! I'm Dr. Malpani's AI nurse — how can I help you today?"


class DrMalpaniNurse(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    session = AgentSession(
        llm=openai.realtime.RealtimeModel(
            model=os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2025-08-28"),
            voice=os.environ.get("OPENAI_REALTIME_VOICE", "alloy"),
            temperature=0.7,
        ),
        vad=silero.VAD.load(),  # only used by AgentSession plumbing; OpenAI Realtime owns turn detection
    )

    avatar = liveavatar.AvatarSession(
        avatar_id=os.environ["LIVEAVATAR_AVATAR_ID"],
    )

    # Avatar must enter the room before the session starts so audio
    # is routed to the avatar plugin from the first token.
    await avatar.start(session, room=ctx.room)

    await session.start(
        agent=DrMalpaniNurse(),
        room=ctx.room,
    )

    # Speak a fixed greeting without invoking the LLM — the model still
    # synthesizes the audio (so voice matches subsequent turns) but skips
    # generation entirely. Cuts ~500–1500ms vs generate_reply().
    await session.say(
        GREETING,
        allow_interruptions=True,
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
