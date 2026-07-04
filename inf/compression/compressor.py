"""Toon-inspired token compression engine.

Provides a lightweight, dependency-free compressor that reduces prompt, memory,
and log payloads so they fit within a token budget.  The heuristic estimators are
intentionally simple so the module works offline without calling an external
tokenizer.
"""

from __future__ import annotations

import json
from typing import Any


class TokenCompressor:
    """Compress text, chat messages, and logs to stay inside a token budget."""

    DEFAULT_MAX_TOKENS: int = 512
    WORDS_PER_TOKEN: float = 0.75
    CHARS_PER_TOKEN_FALLBACK: float = 4.0

    def __init__(self, default_max_tokens: int | None = DEFAULT_MAX_TOKENS) -> None:
        self.default_max_tokens = default_max_tokens

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Return a fast offline token estimate for *text*.

        The heuristic assumes roughly 0.75 words per token on average.  Empty or
        whitespace-only input costs one token so callers can reason about length
        monotonically.
        """
        if not isinstance(text, str):
            text = json.dumps(text, separators=(",", ":"))
        words = text.split()
        if not words:
            return 1
        return max(1, int(round(len(words) / TokenCompressor.WORDS_PER_TOKEN)))

    def _avg_chars_per_token(self, text: str) -> float:
        """Derive an observed chars-per-token ratio for a specific text."""
        tokens = self.estimate_tokens(text)
        if tokens <= 0:
            return self.CHARS_PER_TOKEN_FALLBACK
        return max(1.0, len(text) / tokens)

    def _char_budget(self, max_tokens: int) -> int:
        """Convert a token budget into a character budget for truncation."""
        # Use a conservative multiplier so the heuristic rarely overshoots.
        return int(max_tokens * self.CHARS_PER_TOKEN_FALLBACK * self.WORDS_PER_TOKEN)

    @staticmethod
    def _clean_text(text: str) -> str:
        """Remove excessive whitespace and empty lines."""
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        return "\n".join(lines)

    def compress(
        self,
        text: str,
        max_tokens: int | None = None,
        preserve_recent: int = 0,
    ) -> str:
        """Compress *text* to fit inside *max_tokens*.

        The most recent *preserve_recent* lines are always kept verbatim.  Older
        content is cleaned, deduplicated, and, if necessary, truncated with a
        summary marker so the whole result fits inside the token budget.

        When *max_tokens* is ``None`` only lightweight cleaning/deduplication is
        applied.
        """
        if not isinstance(text, str):
            text = json.dumps(text, separators=(",", ":"))

        text = self._clean_text(text)
        if not text:
            return ""

        lines = text.splitlines()
        if preserve_recent > 0:
            split_at = max(0, len(lines) - preserve_recent)
            older_lines = lines[:split_at]
            recent_lines = lines[split_at:]
        else:
            older_lines = lines
            recent_lines = []

        older = "\n".join(self._dedupe_lines(older_lines))
        recent = "\n".join(recent_lines)
        recent_tokens = self.estimate_tokens(recent)

        max_tokens = max_tokens if max_tokens is not None else self.default_max_tokens
        if max_tokens is None:
            parts = [p for p in (older, recent) if p]
            return "\n".join(parts)

        available = max(0, max_tokens - recent_tokens)
        if available <= 0:
            # Recent lines alone already exceed the budget; truncate them.
            return self._truncate_to_tokens(recent, max_tokens)

        if self.estimate_tokens(older) <= available:
            parts = [p for p in (older, recent) if p]
            return "\n".join(parts)

        compressed_older = self._summarize_lines(older_lines, available)
        parts = [p for p in (compressed_older, recent) if p]
        return "\n".join(parts)

    def _dedupe_lines(self, lines: list[str]) -> list[str]:
        """Collapse consecutive identical lines while preserving order."""
        if not lines:
            return []
        deduped: list[str] = []
        prev = lines[0]
        count = 1
        for line in lines[1:]:
            if line == prev:
                count += 1
            else:
                deduped.append(self._repeat_line(prev, count))
                prev = line
                count = 1
        deduped.append(self._repeat_line(prev, count))
        return deduped

    @staticmethod
    def _repeat_line(line: str, count: int) -> str:
        if count <= 1:
            return line
        return f"{line} (x{count})"

    def _summarize_lines(self, lines: list[str], max_tokens: int) -> str:
        """Summarize a list of lines to fit *max_tokens*."""
        if not lines:
            return ""
        cleaned = self._dedupe_lines(lines)
        text = "\n".join(cleaned)
        if self.estimate_tokens(text) <= max_tokens:
            return text
        budget = self._char_budget(max_tokens)
        truncated = text[:budget]
        # Avoid cutting mid-word if possible.
        if len(text) > budget:
            truncated = truncated.rsplit(" ", 1)[0]
        marker = f"[... {len(lines)} lines summarized ...]"
        return f"{marker}\n{truncated}".strip()

    def _truncate_to_tokens(self, text: str, max_tokens: int) -> str:
        """Hard-truncate *text* to *max_tokens* with an ellipsis marker."""
        if self.estimate_tokens(text) <= max_tokens:
            return text
        budget = self._char_budget(max_tokens)
        truncated = text[:budget].rsplit(" ", 1)[0]
        return f"{truncated}\n[... truncated ...]".strip()

    def compress_messages(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int | None = None,
    ) -> list[dict[str, Any]]:
        """Compress a list of chat messages.

        Latest turns are preserved verbatim while older turns are collapsed into
        a single summary message.  System messages are kept when possible because
        they usually carry instructions.
        """
        if not messages:
            return []

        cleaned: list[dict[str, Any]] = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if isinstance(content, str):
                content = self._clean_text(content)
            cleaned.append({"role": role, "content": content})

        max_tokens = max_tokens if max_tokens is not None else self.default_max_tokens
        if max_tokens is None:
            return cleaned

        total = sum(self.estimate_tokens(json.dumps(m, separators=(",", ":"))) for m in cleaned)
        if total <= max_tokens:
            return cleaned

        # Try to keep system messages and the most recent user/assistant turns.
        system_messages = [m for m in cleaned if m.get("role") == "system"]
        non_system = [m for m in cleaned if m.get("role") != "system"]
        system_tokens = sum(
            self.estimate_tokens(json.dumps(m, separators=(",", ":"))) for m in system_messages
        )
        available = max(0, max_tokens - system_tokens)

        kept: list[dict[str, Any]] = list(system_messages)
        remaining_budget = available
        split_index = len(non_system)
        for i in range(len(non_system) - 1, -1, -1):
            msg_tokens = self.estimate_tokens(
                json.dumps(non_system[i], separators=(",", ":"))
            )
            if msg_tokens <= remaining_budget:
                kept.insert(len(system_messages), non_system[i])
                remaining_budget -= msg_tokens
            else:
                split_index = i
                break

        older = non_system[: split_index + 1]
        if older:
            summary_content = self._summarize_older_messages(older)
            summary = {
                "role": "system",
                "content": f"[Earlier conversation summary]\n{summary_content}",
            }
            kept.insert(0, summary)

        return kept

    @staticmethod
    def _summarize_older_messages(messages: list[dict[str, Any]]) -> str:
        """Create a compact textual summary of older messages."""
        lines = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if isinstance(content, str):
                preview = content.strip().replace("\n", " ")
            else:
                preview = json.dumps(content, separators=(",", ":"))
            preview = preview[:120]
            lines.append(f"{role}: {preview}")
        if not lines:
            return ""
        return "\n".join(lines)

    def compress_logs(
        self,
        logs: list[str],
        max_tokens: int | None = None,
    ) -> str:
        """Collapse repeated log lines and summarize older logs.

        The most recent lines are prioritized.  Consecutive identical lines are
        merged into ``line (xN)`` form.
        """
        cleaned = [line.strip() for line in logs if line and line.strip()]
        if not cleaned:
            return ""

        deduped = self._dedupe_lines(cleaned)
        text = "\n".join(deduped)
        max_tokens = max_tokens if max_tokens is not None else self.default_max_tokens
        if max_tokens is None or self.estimate_tokens(text) <= max_tokens:
            return text

        # Decide how many recent lines to keep based on the average line cost.
        avg_tokens_per_line = max(1, self.estimate_tokens(text) // max(len(deduped), 1))
        # Reserve half the budget for a summary of older lines and half for recent lines.
        recent_budget = max_tokens // 2
        recent_count = min(len(deduped), max(1, recent_budget // avg_tokens_per_line))
        older_lines = deduped[:-recent_count]
        recent_lines = deduped[-recent_count:]
        recent = "\n".join(recent_lines)
        available = max(0, max_tokens - self.estimate_tokens(recent))
        older_summary = self._summarize_lines(older_lines, available)
        parts = [p for p in (older_summary, recent) if p]
        return "\n".join(parts)

    @staticmethod
    def compress_value(value: Any, max_tokens: int | None = None) -> Any:
        """Recursively compress string values inside a JSON-like structure.

        Dicts and lists are traversed; strings are passed through
        :meth:`compress`.  Other values are returned unchanged.
        """
        compressor = TokenCompressor(default_max_tokens=max_tokens)
        return compressor._compress_value_recursive(value)  # noqa: SLF001

    def _compress_value_recursive(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.compress(value, max_tokens=self.default_max_tokens)
        if isinstance(value, dict):
            return {k: self._compress_value_recursive(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._compress_value_recursive(item) for item in value]
        return value
