import json
import os
from dotenv import load_dotenv
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import openai, elevenlabs, liveavatar, silero

from prompt import SYSTEM_PROMPT

load_dotenv()

GREETING = "Hi! I'm Dr. Malpani's AI nurse — how can I help you today?"


class DrMalpaniNurse(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    session = AgentSession(
        stt=openai.STT(),
        llm=openai.LLM(model="gpt-4o"),
        tts=elevenlabs.TTS(
            model="eleven_flash_v2_5",
            voice_id=os.environ["ELEVENLABS_VOICE_ID"],
        ),
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

    await session.say(GREETING, allow_interruptions=False)

    await ctx.room.local_participant.publish_data(
        payload=json.dumps({"type": "greeting_done"}).encode(),
        reliable=True,
        topic="control",
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
