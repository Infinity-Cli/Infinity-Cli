"""SQLite-backed short-term memory."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from inf.compression import TokenCompressor
from inf.persistence.db import Database

logger = logging.getLogger(__name__)


class ShortTermMemory:
    """Stores short-lived JSON values keyed by scope and key."""

    def __init__(self, db: Database) -> None:
        self.db = db

    async def add(
        self,
        scope: str,
        key: str,
        value: dict[str, Any],
        compress: bool = False,
    ) -> None:
        """Store a JSON value under the given scope and key.

        When *compress* is ``True``, string fields inside *value* are run through
        the Toon-inspired token compressor before persistence.
        """
        payload = TokenCompressor.compress_value(value) if compress else value
        await self.db.execute(
            """
            INSERT INTO short_term_memory (scope, key, value, created_at)
            VALUES (?, ?, ?, ?);
            """,
            (scope, key, json.dumps(payload), datetime.now(timezone.utc).isoformat()),
        )
        await self.db.commit()

    async def get(self, scope: str, key: str) -> dict[str, Any] | None:
        """Retrieve the most recent value for a scope/key pair."""
        row = await self.db.fetchone(
            """
            SELECT value FROM short_term_memory
            WHERE scope = ? AND key = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1;
            """,
            (scope, key),
        )
        if row is None:
            return None
        return json.loads(row[0])

    async def list_recent(self, scope: str, limit: int = 10) -> list[dict[str, Any]]:
        """Return recent entries for a scope, newest first."""
        rows = await self.db.fetchall(
            """
            SELECT id, scope, key, value, created_at
            FROM short_term_memory
            WHERE scope = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?;
            """,
            (scope, limit),
        )
        return [
            {
                "id": row[0],
                "scope": row[1],
                "key": row[2],
                "value": json.loads(row[3]),
                "created_at": row[4],
            }
            for row in rows
        ]

    async def clear(self, scope: str) -> None:
        """Delete all entries for the given scope."""
        await self.db.execute(
            "DELETE FROM short_term_memory WHERE scope = ?;",
            (scope,),
        )
        await self.db.commit()
