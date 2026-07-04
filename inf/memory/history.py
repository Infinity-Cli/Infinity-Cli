"""SQLite-backed task history for runs and agents."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from inf.compression import TokenCompressor
from inf.persistence.db import Database

logger = logging.getLogger(__name__)


class TaskHistory:
    """Records and queries task outcomes across runs and agents."""

    def __init__(self, db: Database) -> None:
        self.db = db

    async def record(
        self,
        run_id: str,
        agent_id: str,
        task: str,
        outcome: dict[str, Any],
        compress: bool = False,
    ) -> None:
        """Persist a task outcome to history.

        When *compress* is ``True``, the task string and string fields in
        *outcome* are run through the token compressor before storage.
        """
        compressed_task = (
            TokenCompressor().compress(task) if compress and isinstance(task, str) else task
        )
        compressed_outcome = (
            TokenCompressor.compress_value(outcome) if compress else outcome
        )
        await self.db.execute(
            """
            INSERT INTO task_history (run_id, agent_id, task, outcome, created_at)
            VALUES (?, ?, ?, ?, ?);
            """,
            (
                run_id,
                agent_id,
                compressed_task,
                json.dumps(compressed_outcome),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        await self.db.commit()

    async def get_run_history(self, run_id: str) -> list[dict[str, Any]]:
        """Return task history for a run, oldest first."""
        rows = await self.db.fetchall(
            """
            SELECT id, run_id, agent_id, task, outcome, created_at
            FROM task_history
            WHERE run_id = ?
            ORDER BY created_at ASC, id ASC;
            """,
            (run_id,),
        )
        return [_row_to_dict(row) for row in rows]

    async def get_agent_history(
        self, agent_id: str, limit: int = 20
    ) -> list[dict[str, Any]]:
        """Return recent task history for an agent, newest first."""
        rows = await self.db.fetchall(
            """
            SELECT id, run_id, agent_id, task, outcome, created_at
            FROM task_history
            WHERE agent_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?;
            """,
            (agent_id, limit),
        )
        return [_row_to_dict(row) for row in rows]


def _row_to_dict(row: tuple[Any, ...]) -> dict[str, Any]:
    """Convert a task_history row tuple to a dictionary."""
    return {
        "id": row[0],
        "run_id": row[1],
        "agent_id": row[2],
        "task": row[3],
        "outcome": json.loads(row[4]),
        "created_at": row[5],
    }
