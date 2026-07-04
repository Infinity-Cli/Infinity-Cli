"""DAG orchestrator for agent task execution."""

import asyncio
import logging
from pathlib import Path
from typing import Optional, Sequence

import networkx as nx

from inf.agents.registry import AGENT_REGISTRY, create_agent
from inf.models.router import ModelRouter
from inf.persistence.db import Database
from inf.persistence.models import RuntimeStatus, Task
from inf.persistence.repositories import TaskRepository
from inf.runtime.helpers import run_single_agent_loop
from inf.sync.api_client import SyncClient

logger = logging.getLogger(__name__)


class Orchestrator:
    """Build and topologically sort a simple task DAG."""

    def __init__(self) -> None:
        self.graph: nx.DiGraph = nx.DiGraph()

    def build_dag(self, tasks: Sequence[str]) -> nx.DiGraph:
        """Build a linear DAG from an ordered list of task names."""
        self.graph.clear()
        for i, task in enumerate(tasks):
            self.graph.add_node(task, index=i)
            if i > 0:
                self.graph.add_edge(tasks[i - 1], task)
        return self.graph

    def execution_order(self) -> list[str]:
        """Return a topological ordering of the current DAG."""
        if not self.graph:
            return []
        return list(nx.topological_sort(self.graph))

    async def execute(self, goal: str) -> list[str]:
        """Stub async executor that logs planned steps."""
        order = self.execution_order()
        logger.info("Executing goal: %s", goal)
        for step in order:
            logger.info("Step: %s", step)
        return order

    async def execute_goal(
        self,
        goal: str,
        *,
        db: Database,
        model_router: ModelRouter | None,
        workspace_root: Path,
        max_agents: int = 10,
        timeout: int = 3600,
        enable_sync: bool = False,
        sync_base_url: Optional[str] = None,
        **loop_kwargs,
    ) -> dict:
        """Execute a swarm of registered agents for ``goal``.

        One task is generated per agent in :data:`inf.agents.registry.AGENT_REGISTRY`,
        executed in topologically-sorted order and limited to ``max_agents``
        concurrent runs.  Each agent is persisted through ``run_single_agent_loop``.

        Returns a summary dict with ``success``, ``completed``, ``failed`` and
        ``goal`` keys, and persists the summary as a task record.
        """
        if db.connection is None:
            await db.initialize()

        run_id = loop_kwargs.pop("run_id", None) or f"orchestrator-{goal}"
        sync_client: Optional[SyncClient] = None
        if enable_sync:
            sync_client = SyncClient(
                sync_base_url or "http://localhost:8000",
                run_id,
            )
        agent_ids = list(AGENT_REGISTRY.keys())
        self.build_dag(agent_ids)
        order = self.execution_order()

        semaphore = asyncio.Semaphore(max_agents)
        results: dict[str, bool] = {}

        async def _run_agent(agent_id: str) -> None:
            async with semaphore:
                workspace = workspace_root / agent_id
                workspace.mkdir(parents=True, exist_ok=True)
                agent = create_agent(
                    agent_id,
                    workspace=workspace,
                    task_id=f"{goal}::{agent_id}",
                )
                result = await run_single_agent_loop(
                    agent,
                    db=db,
                    run_id=run_id,
                    task_id=f"{goal}::{agent_id}",
                    model_router=model_router,
                    enable_persistence=True,
                    enable_sync=enable_sync,
                    sync_base_url=sync_base_url,
                    sync_client=sync_client,
                    **loop_kwargs,
                )
                results[agent_id] = result.success

        pending = [asyncio.create_task(_run_agent(aid)) for aid in order]
        done, still_pending = await asyncio.wait(pending, timeout=timeout)

        # Cancel anything that did not finish in time.
        if still_pending:
            for task in still_pending:
                task.cancel()
            await asyncio.gather(*still_pending, return_exceptions=True)

        for aid in order:
            if aid not in results:
                results[aid] = False

        completed = [aid for aid in order if results.get(aid)]
        failed = [aid for aid in order if not results.get(aid)]

        summary = {
            "success": all(results.values()) and not still_pending,
            "completed": completed,
            "failed": failed,
            "goal": goal,
        }

        await TaskRepository.create(
            db,
            Task(
                task_id="orchestrator-summary",
                run_id=run_id,
                agent_id="orchestrator",
                status=RuntimeStatus.COMPLETED if summary["success"] else RuntimeStatus.FAILED,
                input={"goal": goal},
                output=summary,
                retry_count=0,
            ),
        )

        return summary
