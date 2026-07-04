"""SQLite-backed long-term memory with compressed summaries."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from inf.compression import TokenCompressor
from inf.persistence.db import Database
from inf.utils.toon_compressor import ToonCompressor

logger = logging.getLogger(__name__)


class LongTermMemory:
    """Compresses and stores long-term summaries and discrete facts."""

    def __init__(self, db: Database) -> None:
        self.db = db
        self.compressor = ToonCompressor()

    async def summarize_and_store(
        self,
        scope: str,
        key: str,
        items: list[dict[str, Any]],
        compress: bool = False,
    ) -> str:
        """Compress a list of items and persist the summary.

        When *compress* is ``True``, string fields inside *items* are token-
        compressed with the Toon-inspired compressor before the summary is built.
        """
        if compress:
            payload = TokenCompressor.compress_value({"items": items})
            summary = json.dumps(payload, separators=(",", ":"))
        else:
            summary = self.compressor.compress_schema({"items": items})
        await self.db.execute(
            """
            INSERT OR REPLACE INTO long_term_memory (scope, key, summary, created_at)
            VALUES (?, ?, ?, ?);
            """,
            (scope, key, summary, datetime.now(timezone.utc).isoformat()),
        )
        await self.db.commit()
        return summary

    async def upsert_summary(
        self,
        scope: str,
        key: str,
        items: list[dict[str, Any]],
        compress: bool = False,
    ) -> str:
        """Alias for :meth:`summarize_and_store` for downstream callers."""
        return await self.summarize_and_store(scope, key, items, compress=compress)

    async def get_summary(self, scope: str, key: str) -> str | None:
        """Fetch the most recently stored summary for a scope/key pair."""
        row = await self.db.fetchone(
            """
            SELECT summary FROM long_term_memory
            WHERE scope = ? AND key = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1;
            """,
            (scope, key),
        )
        return row[0] if row is not None else None

    async def store_fact(self, scope: str, fact: str) -> None:
        """Store a single fact under a scope."""
        key = f"fact_{datetime.now(timezone.utc).isoformat()}"
        await self.db.execute(
            """
            INSERT INTO long_term_memory (scope, key, summary, created_at)
            VALUES (?, ?, ?, ?);
            """,
            (scope, key, fact, datetime.now(timezone.utc).isoformat()),
        )
        await self.db.commit()

    async def recall_facts(self, scope: str, limit: int = 5) -> list[str]:
        """Recall the most recently stored facts for a scope."""
        rows = await self.db.fetchall(
            """
            SELECT summary FROM long_term_memory
            WHERE scope = ? AND key LIKE 'fact_%'
            ORDER BY created_at DESC, id DESC
            LIMIT ?;
            """,
            (scope, limit),
        )
        return [row[0] for row in rows]
