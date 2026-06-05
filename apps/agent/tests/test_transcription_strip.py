"""Validates the SSML-stripping transcription_node, including tags split
across streaming chunks (LLM deltas can cut a tag anywhere)."""

import asyncio
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Make apps/agent importable (src package + data paths).
AGENT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENT_DIR))

from src.core import DrMalpaniNurse


async def run() -> int:
    agent = DrMalpaniNurse(instructions="test")
    cases = [
        # tag split mid-attribute across stream chunks
        (
            ["I understand. <break ti", 'me="0.4s"/> Let me explain.'],
            "I understand.  Let me explain.",
        ),
        # whole tag in one chunk
        (['Hello <break time="0.5s"/>world'], "Hello world"),
        # no tags at all
        (["plain ", "text"], "plain text"),
        # tag at the very end of the stream
        (['bye <break time="1s"/>'], "bye "),
        # stray '<' that is not markup is kept
        (["two < three"], "two < three"),
        # Hindi text with a tag
        (
            ["मैं समझता हूँ। <break ", 'time="0.4s"/> आइए बताता हूँ।'],
            "मैं समझता हूँ।  आइए बताता हूँ।",
        ),
    ]

    all_passed = True
    for chunks, want in cases:

        async def gen(cs=chunks):
            for c in cs:
                yield c

        got = "".join([s async for s in agent.transcription_node(gen(), None)])
        if got == want:
            print(f"PASS: {chunks!r} -> {got!r}")
        else:
            print(f"FAIL: {chunks!r} -> {got!r} (want {want!r})")
            all_passed = False

    print("\nSUCCESS" if all_passed else "\nFAILURE")
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
