"""Helpers for running the autonomous loop from CLI/orchestrator code."""

from __future__ import annotations

from typing import Any, Optional

from inf.agents.base import BaseAgent
from inf.persistence.db import Database
from inf.runtime.loop import AutonomousLoop, LoopResult


async def run_single_agent_loop(
    agent: BaseAgent,
    db: Optional[Database] = None,
    run_id: Optional[str] = None,
    task_id: Optional[str] = None,
    max_iterations: int = 20,
    max_retries: int = 5,
    base_backoff: float = 1.0,
    max_backoff: float = 60.0,
    enable_persistence: bool = True,
    enable_sync: bool = False,
    sync_base_url: Optional[str] = None,
    sync_client: Optional[Any] = None,
    **kwargs: Any,
) -> LoopResult:
    """Run a single agent through the autonomous loop.

    This helper is the minimal integration point for CLI commands and the DAG
    orchestrator: pass any :class:`BaseAgent` instance and an optional database,
    and the loop drives the agent to completion or guardrail failure.
    """
    loop = AutonomousLoop(
        agent=agent,
        db=db,
        run_id=run_id,
        task_id=task_id,
        max_iterations=max_iterations,
        max_retries=max_retries,
        base_backoff=base_backoff,
        max_backoff=max_backoff,
        enable_persistence=enable_persistence,
        enable_sync=enable_sync,
        sync_base_url=sync_base_url,
        sync_client=sync_client,
        **kwargs,
    )
    return await loop.run()
