"""Knowledge base layer.

The agent's domain knowledge lives in data/kb/*.md as plain markdown so it
can be edited (or extended with new files) without touching code. Files are
concatenated in sorted filename order — keep the numeric prefixes
(01-clinic-info.md, 02-costs.md, ...) to control ordering.

The result must be deterministic and byte-identical between sessions: the
knowledge block is part of the static system prompt, and OpenAI's automatic
prompt prefix caching only hits while the prefix stays unchanged. Never
inject per-session or per-turn data here.

This is also the RAG seam: if the KB ever outgrows the prompt (several
thousand tokens), replace load_kb() with a retrieval call without changing
any caller.
"""

from .config import KB_DIR


def load_kb() -> str:
    """Concatenate all data/kb/*.md files in sorted filename order."""
    sections = []
    for path in sorted(KB_DIR.glob("*.md")):
        text = path.read_text(encoding="utf-8").strip()
        if text:
            sections.append(text)
    return "\n\n".join(sections)
