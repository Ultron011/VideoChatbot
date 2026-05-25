import os
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import openai, liveavatar, silero

from prompt import SYSTEM_PROMPT

load_dotenv()


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
        vad=silero.VAD.load(),
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

    # Trigger the greeting. Because the avatar is already in the room
    # and the user (browser) is already subscribed to its tracks by the
    # time entrypoint runs, the first audio frame is one hop from audible.
    await session.generate_reply(
        instructions=(
            "Greet the user warmly in English as Dr. Malpani's AI nurse. "
            "Keep it to one short sentence."
        )
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
