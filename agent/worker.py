import json
import os
from dotenv import load_dotenv
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import openai, elevenlabs, liveavatar, silero

from prompt import SYSTEM_PROMPT

load_dotenv()

GREETING = "Hi! I'm the AI assistant at Dr. Malpani's clinic — how can I help you today?"


class DrMalpaniNurse(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    session = AgentSession(
        stt=openai.STT(model="gpt-4o-transcribe"),
        llm=openai.LLM(model="gpt-4o-mini"),
        tts=elevenlabs.TTS(
            model="eleven_flash_v2_5",
            voice_id=os.environ["ELEVENLABS_VOICE_ID"],
        ),
        # min_silence_duration: how long the user must pause before we
        # consider their turn over. 300ms feels snappy; raise to 500ms
        # if the agent interrupts too eagerly.
        vad=silero.VAD.load(min_silence_duration=0.3),
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
