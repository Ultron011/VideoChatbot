"""Memory layer: curated FAQ answer cache that short-circuits the LLM.

Matching is deliberately deterministic — measured embedding similarities
(text-embedding-3-small) could NOT separate benign paraphrases (0.57-0.94)
from dangerous one-word meaning flips like "is ivf safe" vs "is ivf
painful" (0.746) or "can i run" vs "can i walk after transfer" (0.783),
so no cosine threshold is safe for a medical agent. Instead:

1. Jaccard word-overlap against every cached query (recall stage).
2. Vocabulary guard (precision stage): every content word of the live
   query must already appear in the matched group's query vocabulary.
   This is exactly what catches the dangerous flips — "safe", "icsi",
   "failure", "consultation" are absent from the matched group's
   phrasings, so the query falls through to the real LLM.

Additional safety gates (prefer false misses over false hits):
- Anaphora ("it", "that", "you said"...) never hits: "how much does it
  cost?" depends on conversation context the cache can't see.
- Devanagari/Hindi queries never hit: cached answers are English.

Recall is tuned by adding more phrasings to a group's "queries" list in
cache.json — that grows both the Jaccard match space and the vocabulary.
"""

import asyncio
import logging
import json
import string
import uuid
from pathlib import Path
from typing import Any

from livekit.agents import (
    llm,
    APIConnectOptions,
    DEFAULT_API_CONNECT_OPTIONS,
    NOT_GIVEN,
    NotGivenOr,
)
from livekit.agents.llm import ChatChunk, ChoiceDelta

logger = logging.getLogger("caching")

JACCARD_THRESHOLD = 0.50

# Question scaffolding — carries no meaning, excluded from the vocabulary
# guard so phrasing differences don't block legitimate hits.
_STOPWORDS = {
    "a", "an", "and", "are", "about", "can", "do", "does", "for", "how",
    "i", "in", "is", "me", "much", "my", "need", "of", "please", "tell",
    "the", "to", "we", "what", "whats", "you", "your",
}

# Words that mean the query depends on conversation context — never serve
# a context-free cached answer for these.
_ANAPHORA = {
    "it", "that", "this", "those", "these", "they", "them",
    "he", "she", "him", "her",
    "above", "earlier", "before", "mentioned", "said", "also",
}


def has_devanagari(text: str) -> bool:
    return any("ऀ" <= ch <= "ॿ" for ch in text)


def _stem(word: str) -> str:
    # Plural-insensitive comparison ("costs" matches "cost").
    if len(word) > 3 and word.endswith("s"):
        return word[:-1]
    return word


class CachingManager:
    def __init__(self, cache_file: Path):
        self.cache_file = cache_file
        self.cache_data: list[dict] = []
        self.load_cache()

    def load_cache(self):
        try:
            if self.cache_file.exists():
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    self.cache_data = json.load(f)
                logger.info(f"Loaded {len(self.cache_data)} cache groups.")
            else:
                logger.warning(f"Cache file {self.cache_file} does not exist.")
        except Exception as e:
            logger.error(f"Failed to load cache: {e}")

    def normalize_text(self, text: str) -> list[str]:
        text = text.lower()
        # strip punctuation
        text = text.translate(str.maketrans("", "", string.punctuation))
        return text.split()

    def get_jaccard_similarity(self, q1: str, q2: str) -> float:
        w1 = set(self.normalize_text(q1))
        w2 = set(self.normalize_text(q2))
        if not w1 or not w2:
            return 0.0
        return len(w1 & w2) / len(w1 | w2)

    def is_cacheable(self, query: str) -> bool:
        """Context gates: only context-free English questions may hit."""
        if has_devanagari(query):
            return False
        words = set(self.normalize_text(query))
        if not words:
            return False
        if words & _ANAPHORA:
            return False
        return True

    def _vocab_guard(self, query: str, group: dict, matched_query: str) -> bool:
        """Bidirectional content-word check.

        Forward: every content word of the query must appear somewhere in
        the group's phrasings. A word the group has never seen ("safe",
        "icsi", "consultation") means the meaning may differ — reject.

        Reverse: every content word of the best-matched cached query must
        appear in the live query. Catches under-specified questions like
        "what is ivf" matching "what is the cost of ivf" — the user never
        said "cost", so the cost answer would be wrong."""
        vocab = {
            _stem(w)
            for cached_query in group.get("queries", [])
            for w in self.normalize_text(cached_query)
        }
        query_words = {_stem(w) for w in self.normalize_text(query)}
        content_words = {
            _stem(w)
            for w in self.normalize_text(query)
            if w not in _STOPWORDS
        }
        unknown = content_words - vocab
        if unknown:
            logger.info(
                f"Cache REJECT for query: '{query}' (unknown words: {sorted(unknown)})"
            )
            return False

        matched_content = {
            _stem(w)
            for w in self.normalize_text(matched_query)
            if w not in _STOPWORDS
        }
        missing = matched_content - query_words
        if missing:
            logger.info(
                f"Cache REJECT for query: '{query}' (matched '{matched_query}' "
                f"but query lacks: {sorted(missing)})"
            )
            return False
        return True

    def match_query(self, query: str, threshold: float = JACCARD_THRESHOLD) -> str | None:
        if not self.is_cacheable(query):
            return None

        best_score = 0.0
        best_group: dict | None = None
        best_query = ""
        for group in self.cache_data:
            for cached_query in group.get("queries", []):
                score = self.get_jaccard_similarity(query, cached_query)
                if score > best_score:
                    best_score = score
                    best_group = group
                    best_query = cached_query

        if best_group is None or best_score < threshold:
            return None
        if not self._vocab_guard(query, best_group, best_query):
            return None

        logger.info(f"Cache HIT for query: '{query}' (score: {best_score:.2f})")
        return best_group.get("answer")


class CachedLLMStream(llm.LLMStream):
    def __init__(
        self,
        llm: llm.LLM,
        chat_ctx: llm.ChatContext,
        text: str,
    ) -> None:
        self._text = text
        super().__init__(
            llm=llm,
            chat_ctx=chat_ctx,
            tools=[],
            conn_options=DEFAULT_API_CONNECT_OPTIONS
        )

    async def _run(self) -> None:
        request_id = f"chatcmpl-cached-{uuid.uuid4().hex[:12]}"
        words = self._text.split(" ")
        for i, word in enumerate(words):
            chunk_text = word if i == 0 else " " + word
            delta = ChoiceDelta(
                role="assistant",
                content=chunk_text
            )
            chunk = ChatChunk(
                id=request_id,
                delta=delta
            )
            self._event_ch.send_nowait(chunk)
            await asyncio.sleep(0.01)


class CachedLLM(llm.LLM):
    def __init__(self, delegate: llm.LLM, cache_file: Path):
        super().__init__()
        self._delegate = delegate
        self._caching_manager = CachingManager(cache_file)
        # LLMStream emits metrics on the LLM instance that created it: the
        # delegate's streams emit on the delegate, which nothing listens to.
        # Forward them so AgentSession metrics/usage see the real LLM calls.
        self._delegate.on(
            "metrics_collected",
            lambda ev: self.emit("metrics_collected", ev),
        )

    @property
    def caching_manager(self) -> CachingManager:
        return self._caching_manager

    @property
    def model(self) -> str:
        return self._delegate.model

    @property
    def provider(self) -> str:
        return f"Cached({self._delegate.provider})"

    def chat(
        self,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool] | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        parallel_tool_calls: NotGivenOr[bool] = NOT_GIVEN,
        tool_choice: NotGivenOr[llm.ToolChoice] = NOT_GIVEN,
        extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN,
    ) -> llm.LLMStream:
        last_user_msg = None
        for msg in reversed(chat_ctx.messages()):
            if msg.role == "user" and msg.text_content:
                last_user_msg = msg.text_content
                break

        if last_user_msg:
            cached_answer = self._caching_manager.match_query(last_user_msg)
            if cached_answer:
                return CachedLLMStream(
                    llm=self,
                    chat_ctx=chat_ctx,
                    text=cached_answer
                )

        return self._delegate.chat(
            chat_ctx=chat_ctx,
            tools=tools,
            conn_options=conn_options,
            parallel_tool_calls=parallel_tool_calls,
            tool_choice=tool_choice,
            extra_kwargs=extra_kwargs,
        )
