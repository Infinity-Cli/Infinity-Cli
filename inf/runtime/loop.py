"""Autonomous execution loop engine.

Implements the Think -> Plan -> Execute -> Test -> Observe -> Repair -> Retry
lifecycle with retry caps, exponential backoff, jitter, and guardrails against
infinite loops and cyclic failures.  The loop integrates the Skylos sandbox
validator, model router, and Toon/Token compressors, and persists state through
the existing Infinity persistence layer.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Callable, Dict, List, Optional

from inf.agents.base import AgentResult, BaseAgent
from inf.models.router import ModelRouter
from inf.persistence.db import Database
from inf.persistence.models import RuntimeStatus
from inf.persistence.repositories import (
    AgentRepository,
    ExecutionLogRepository,
    TaskRepository,
)
from inf.security.sandbox import SandboxValidator
from inf.sync.api_client import SyncClient
from inf.utils.toon_compressor import ToonCompressor

logger = logging.getLogger(__name__)


class LoopStage(StrEnum):
    """Named stages of the autonomous execution loop."""

    THINK = "think"
    PLAN = "plan"
    EXECUTE = "execute"
    TEST = "test"
    OBSERVE = "observe"
    REPAIR = "repair"
    RETRY = "retry"
    COMPLETE = "complete"
    FAILED = "failed"


class LoopGuardError(Exception):
    """Raised when a loop guardrail is breached."""


@dataclass
class LoopEvent:
    """A single recorded loop transition."""

    stage: str
    iteration: int
    retry_count: int
    success: Optional[bool] = None
    message: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class LoopResult:
    """Final outcome of an autonomous loop run."""

    success: bool
    output: Any = None
    error: Optional[str] = None
    iterations: int = 0
    retries: int = 0
    events: List[LoopEvent] = field(default_factory=list)
    status: str = "unknown"


class AutonomousLoop:
    """Drive a :class:`BaseAgent` through the autonomous loop lifecycle.

    Parameters
    ----------
    agent:
        The agent to execute.  Must provide ``think``, ``execute``, ``test``,
        and optionally ``repair`` coroutines.
    max_iterations:
        Hard ceiling on the number of execute/test/observe cycles.
    max_retries:
        Maximum repair/retry attempts after a failure.
    base_backoff:
        Initial retry delay in seconds.
    max_backoff:
        Upper bound on retry delay in seconds.
    cycle_window:
        Number of recent failure states to compare for cycle detection.
    jitter:
        When ``True``, randomize backoff within ``[delay/2, delay]``.
    db:
        Optional async SQLite database for persistence.
    run_id:
        Identifier for the run.  Defaults to ``run-<agent.id>``.
    task_id:
        Identifier for the task.  Defaults to ``agent.task_id``.
    model_router:
        Optional model router used to refine the agent's thought/plan.
    compressor:
        Optional compressor for prompts/plans.  Falls back to
        :class:`ToonCompressor`.
    sandbox:
        Optional :class:`SandboxValidator` used to validate the plan stage.
    enable_persistence:
        When ``False``, state is kept in memory even if ``db`` is supplied.
    enable_sync:
        When ``True``, push status/log events to Infinity-api and poll for
        remote commands such as ``pause``.
    sync_base_url:
        Infinity-api base URL. Falls back to ``INFINITY_SYNC_BASE_URL`` and
        then ``http://localhost:8000``.
    sync_client:
        Optional preconfigured :class:`SyncClient` instance.
    """

    def __init__(
        self,
        agent: BaseAgent,
        max_iterations: int = 20,
        max_retries: int = 5,
        base_backoff: float = 1.0,
        max_backoff: float = 60.0,
        cycle_window: int = 10,
        jitter: bool = True,
        db: Optional[Database] = None,
        run_id: Optional[str] = None,
        task_id: Optional[str] = None,
        model_router: Optional[ModelRouter] = None,
        compressor: Optional[Any] = None,
        sandbox: Optional[SandboxValidator] = None,
        enable_persistence: bool = True,
        enable_sync: bool = False,
        sync_base_url: Optional[str] = None,
        sync_client: Optional[SyncClient] = None,
    ) -> None:
        self.agent = agent
        self.max_iterations = max(1, max_iterations)
        self.max_retries = max(0, max_retries)
        self.base_backoff = max(0.0, base_backoff)
        self.max_backoff = max(self.base_backoff, max_backoff)
        self.cycle_window = max(1, cycle_window)
        self.jitter = jitter
        self.db = db
        self.run_id = run_id or f"run-{agent.id}"
        self.task_id = task_id or agent.task_id
        self.model_router = model_router
        self.compressor = compressor or ToonCompressor()
        self.sandbox = sandbox
        self.enable_persistence = enable_persistence and db is not None
        self.enable_sync = enable_sync
        self.sync_base_url = sync_base_url
        self._provided_sync_client = sync_client
        self._sync_client: Optional[SyncClient] = None
        self._sync_stop = asyncio.Event()
        self._sync_poller_task: Optional[asyncio.Task[None]] = None

        self.iteration = 0
        self.retry_count = 0
        self.events: List[LoopEvent] = []
        self.state_hashes: List[str] = []
        self.stage = LoopStage.THINK
        self._last_result: Optional[AgentResult] = None

    @property
    def _can_persist(self) -> bool:
        return self.enable_persistence and self.db is not None

    def _get_sync_client(self) -> SyncClient:
        """Return the configured sync client, creating one if necessary."""
        if self._sync_client is not None:
            return self._sync_client
        if self._provided_sync_client is not None:
            self._sync_client = self._provided_sync_client
            return self._sync_client
        base_url = (
            self.sync_base_url
            or os.getenv("INFINITY_SYNC_BASE_URL")
            or "http://localhost:8000"
        )
        self._sync_client = SyncClient(base_url, self.run_id)
        return self._sync_client

    async def _sync_register(self, sync: SyncClient) -> None:
        try:
            await sync.register_runtime(
                {
                    "agent_id": self.agent.id,
                    "task_id": self.task_id,
                    "status": "online",
                }
            )
        except Exception as exc:
            logger.warning("Sync register failed: %s", exc)

    async def _sync_push_status(
        self, sync: SyncClient, status: str, extra: Optional[Dict[str, Any]] = None
    ) -> None:
        try:
            payload: Dict[str, Any] = {
                "agent_id": self.agent.id,
                "task_id": self.task_id,
                "status": status,
            }
            if extra:
                payload.update(extra)
            await sync.push_status(payload)
        except Exception as exc:
            logger.warning("Sync status push failed: %s", exc)

    async def _sync_push_log(self, sync: SyncClient, level: str, message: str) -> None:
        try:
            await sync.push_log(
                level,
                message,
                agent_id=self.agent.id,
                task_id=self.task_id,
            )
        except Exception as exc:
            logger.warning("Sync log push failed: %s", exc)

    async def _finalize_run(
        self, sync: Optional[SyncClient], result: LoopResult
    ) -> LoopResult:
        """Push final sync status and tear down the command poller."""
        if sync is not None:
            await self._sync_push_status(
                sync, "completed" if result.success else "failed"
            )
            self._sync_stop.set()
            if self._sync_poller_task is not None:
                self._sync_poller_task.cancel()
                try:
                    await self._sync_poller_task
                except asyncio.CancelledError:
                    pass
            if (
                self._sync_client is not None
                and self._sync_client is not self._provided_sync_client
            ):
                await self._sync_client.close()
                self._sync_client = None
        return result

    async def _sync_poll_commands(self, sync: SyncClient) -> None:
        """Background task that polls for and claims remote commands."""
        while not self._sync_stop.is_set():
            try:
                commands = await sync.poll_commands()
                for cmd in commands:
                    action = cmd.get("action")
                    if action == "pause":
                        await sync.claim_command(cmd["id"])
            except Exception as exc:
                logger.warning("Sync command poll failed: %s", exc)
            try:
                await asyncio.wait_for(self._sync_stop.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                pass

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _hash_state(self, stage: str, data: Any) -> str:
        payload = json.dumps(
            {
                "agent_id": self.agent.id,
                "task_id": self.task_id,
                "stage": stage,
                "retry": self.retry_count,
                "data": data,
            },
            sort_keys=True,
            default=str,
        )
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    def _hash_failure_state(self, result: AgentResult, tested: AgentResult) -> str:
        """Hash a failure signature independent of retry count so cycles can be detected."""
        payload = json.dumps(
            {
                "agent_id": self.agent.id,
                "task_id": self.task_id,
                "result_error": result.error,
                "tested_error": tested.error,
                "result_success": result.success,
                "tested_success": tested.success,
            },
            sort_keys=True,
            default=str,
        )
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    def _detect_cycle(self, state_hash: str) -> bool:
        """Return ``True`` if *state_hash* repeats at least ``cycle_window`` times."""
        self.state_hashes.append(state_hash)
        if len(self.state_hashes) > self.cycle_window:
            self.state_hashes.pop(0)
        return self.state_hashes.count(state_hash) >= self.cycle_window

    def _backoff_seconds(self) -> float:
        """Compute the next retry delay using exponential backoff and jitter."""
        delay = min(self.base_backoff * (2 ** self.retry_count), self.max_backoff)
        if self.jitter:
            # Jitter within [delay/2, delay] and clamp to the configured maximum.
            delay = delay * (0.5 + 0.5 * random.random())
            delay = min(delay, self.max_backoff)
        return delay

    def _compress_value(self, value: Any) -> Any:
        """Apply the configured compressor to *value* when possible.

        When the compressor does not expose a recursive ``compress_value``
        helper, strings inside dicts and lists are compressed individually.
        """
        if self.compressor is None:
            return value
        if hasattr(self.compressor, "compress_value"):
            return self.compressor.compress_value(value)
        if hasattr(self.compressor, "compress_prompt"):

            def _recursive(value: Any) -> Any:
                if isinstance(value, str):
                    return self.compressor.compress_prompt(value)
                if isinstance(value, dict):
                    return {k: _recursive(v) for k, v in value.items()}
                if isinstance(value, list):
                    return [_recursive(item) for item in value]
                return value

            return _recursive(value)
        return value

    async def _persist_agent(self, status: RuntimeStatus, payload: Optional[Dict[str, Any]] = None) -> None:
        if not self._can_persist:
            return
        db = self.db
        assert db is not None
        from inf.persistence.models import AgentState

        await AgentRepository.create_or_update(
            db,
            AgentState(
                agent_id=self.agent.id,
                role=self.agent.role,
                status=status,
                goal=self.task_id,
                payload=payload or {"run_id": self.run_id, "task_id": self.task_id},
            ),
        )

    async def _persist_task(
        self,
        status: RuntimeStatus,
        output: Optional[Dict[str, Any]] = None,
    ) -> None:
        if not self._can_persist:
            return
        db = self.db
        assert db is not None
        from inf.persistence.models import Task

        existing = await TaskRepository.get(db, self.run_id, self.task_id)
        if existing is None:
            await TaskRepository.create(
                db,
                Task(
                    task_id=self.task_id,
                    run_id=self.run_id,
                    agent_id=self.agent.id,
                    status=status,
                    input={"goal": self.task_id},
                    output=output or {},
                    retry_count=self.retry_count,
                ),
            )
        else:
            await TaskRepository.update_status(
                db,
                self.run_id,
                self.task_id,
                status,
                output=output,
                retry_count=self.retry_count,
            )

    async def _log(self, level: str, message: str) -> None:
        event = LoopEvent(
            stage=self.stage,
            iteration=self.iteration,
            retry_count=self.retry_count,
            message=message,
        )
        self.events.append(event)
        logger.log(
            getattr(logging, level.upper(), logging.INFO),
            "[loop][%s][iter=%d][retry=%d] %s",
            self.stage,
            self.iteration,
            self.retry_count,
            message,
        )
        if not self._can_persist:
            return
        db = self.db
        assert db is not None
        from inf.persistence.models import ExecutionLog

        await ExecutionLogRepository.append(
            db,
            ExecutionLog(
                run_id=self.run_id,
                agent_id=self.agent.id,
                task_id=self.task_id,
                level=level,
                message=message,
            ),
        )

        if self.enable_sync:
            try:
                sync = self._get_sync_client()
                await self._sync_push_log(sync, level, message)
            except Exception as exc:
                logger.warning("Sync log push failed: %s", exc)

    async def think(self) -> Dict[str, Any]:
        """Run the agent's think stage and optionally refine/compress the result."""
        self.stage = LoopStage.THINK
        thought = await self.agent.think()
        if self.model_router is not None:
            refined = await self._refine_with_model_router(thought)
            if refined is not None:
                thought["refined_plan"] = refined
        thought = self._compress_value(thought)
        await self._persist_agent(RuntimeStatus.RUNNING, payload={"thought": thought})
        await self._log("info", f"Think complete: {json.dumps(thought, default=str)[:120]}")
        return thought

    async def _refine_with_model_router(self, thought: Dict[str, Any]) -> Optional[str]:
        """Try each registered provider until one succeeds."""
        messages = [
            {
                "role": "system",
                "content": "You refine an agent plan. Reply only with concise text.",
            },
            {"role": "user", "content": json.dumps(thought, default=str)},
        ]
        if self.model_router is None:
            return None
        model_router = self.model_router
        for provider_name in list(model_router._registry.keys()):
            try:
                return await model_router.chat(messages, provider=provider_name)
            except Exception as exc:  # pragma: no cover - providers are optional
                await self._log("warning", f"Provider '{provider_name}' skipped: {exc}")
        return None

    async def plan(self, thought: Dict[str, Any]) -> Dict[str, Any]:
        """Derive a plan from the thought and validate it through the sandbox."""
        self.stage = LoopStage.PLAN
        plan = {
            "source": thought,
            "steps": [LoopStage.EXECUTE, LoopStage.TEST, LoopStage.OBSERVE],
        }
        if self.sandbox is not None:
            plan_text = json.dumps(plan, default=str)
            result = self.sandbox.validate(
                plan_text,
                allowed_paths=[self.agent.workspace],
                scope="read",
            )
            if not result["ok"]:
                raise LoopGuardError(f"Sandbox rejected plan: {result['reason']}")
        await self._log("info", "Plan stage complete")
        return plan

    async def execute(self) -> AgentResult:
        """Run the agent's execute stage."""
        self.stage = LoopStage.EXECUTE
        result = await self.agent.execute()
        self._last_result = result
        await self._log("info", f"Execute: success={result.success} error={result.error}")
        return result

    async def test(self, result: AgentResult) -> AgentResult:
        """Run the agent's test stage."""
        self.stage = LoopStage.TEST
        tested = await self.agent.test(result)
        await self._log("info", f"Test: success={tested.success} error={tested.error}")
        return tested

    async def observe(self, result: AgentResult, tested: AgentResult) -> str:
        """Evaluate execution and test results, persist state, and return the outcome."""
        self.stage = LoopStage.OBSERVE
        if result.success and tested.success:
            await self._persist_agent(RuntimeStatus.COMPLETED)
            await self._persist_task(RuntimeStatus.COMPLETED, output={"result": result.output})
            await self._log("info", "Observation: success")
            return "success"

        reason = tested.error or result.error or "unknown failure"
        if self._last_result is not None and self._last_result.error is None:
            self._last_result.error = reason
        await self._persist_task(RuntimeStatus.RETRYING, output={"error": reason})
        await self._log("warning", f"Observation: failure - {reason}")
        return "failure"

    async def repair(self, result: AgentResult) -> None:
        """Ask the agent to repair a failed result when a repair method exists."""
        self.stage = LoopStage.REPAIR
        repair_method: Optional[Callable[..., Any]] = getattr(self.agent, "repair", None)
        base_repair = getattr(BaseAgent, "repair", None)
        is_default_noop = base_repair is not None and getattr(repair_method, "__func__", None) is base_repair
        if repair_method is not None and callable(repair_method) and not is_default_noop:
            await repair_method(result)
            await self._log("info", "Repair attempted")
        else:
            await self._log("warning", "Agent has no repair method; skipping repair")

    async def retry(self) -> None:
        """Pause for exponential backoff and increment the retry counter."""
        self.stage = LoopStage.RETRY
        if self.retry_count >= self.max_retries:
            raise LoopGuardError(f"Max retries ({self.max_retries}) exceeded")
        delay = self._backoff_seconds()
        await self._log(
            "info",
            f"Retry {self.retry_count + 1}/{self.max_retries} after {delay:.2f}s backoff",
        )
        await asyncio.sleep(delay)
        self.retry_count += 1

    async def run(self) -> LoopResult:
        """Run the full autonomous loop until success, failure, or guardrail."""
        sync: Optional[SyncClient] = None
        if self.enable_sync:
            sync = self._get_sync_client()
            await self._sync_register(sync)
            await self._sync_push_status(sync, "running")
            self._sync_stop.clear()
            self._sync_poller_task = asyncio.create_task(
                self._sync_poll_commands(sync)
            )

        try:
            await self._persist_task(RuntimeStatus.PENDING)
            thought = await self.think()
            await self.plan(thought)
        except Exception as exc:
            await self._log("error", f"Setup failed: {exc}")
            return await self._finalize_run(
                sync,
                LoopResult(
                    success=False,
                    error=str(exc),
                    iterations=self.iteration,
                    retries=self.retry_count,
                    events=self.events,
                    status=LoopStage.FAILED,
                ),
            )

        while self.iteration < self.max_iterations:
            self.iteration += 1

            try:
                result = await self.execute()
                tested = await self.test(result)
                outcome = await self.observe(result, tested)
            except Exception as exc:
                await self._log("error", f"Stage exception: {exc}")
                outcome = "failure"
                self._last_result = AgentResult(success=False, error=str(exc))
                result = self._last_result
                tested = result

            if outcome == "success":
                self.stage = LoopStage.COMPLETE
                await self._log("info", "Loop complete")
                return await self._finalize_run(
                    sync,
                    LoopResult(
                        success=True,
                        output=result.output,
                        iterations=self.iteration,
                        retries=self.retry_count,
                        events=self.events,
                        status=LoopStage.COMPLETE,
                    ),
                )

            failure_signature = self._hash_failure_state(result, tested)
            if self._detect_cycle(failure_signature):
                await self._log("error", "Cycle detected in failure state")
                await self._persist_task(
                    RuntimeStatus.FAILED,
                    output={"error": "Cycle detected"},
                )
                return await self._finalize_run(
                    sync,
                    LoopResult(
                        success=False,
                        error="Cycle detected",
                        iterations=self.iteration,
                        retries=self.retry_count,
                        events=self.events,
                        status=LoopStage.FAILED,
                    ),
                )

            if self.retry_count >= self.max_retries:
                await self._log("error", "Max retries exceeded")
                await self._persist_task(
                    RuntimeStatus.FAILED,
                    output={"error": self._last_result.error if self._last_result else "max retries"},
                )
                return await self._finalize_run(
                    sync,
                    LoopResult(
                        success=False,
                        error=self._last_result.error if self._last_result else "max retries",
                        iterations=self.iteration,
                        retries=self.retry_count,
                        events=self.events,
                        status=LoopStage.FAILED,
                    ),
                )

            await self.repair(result)
            await self.retry()

        await self._log("error", f"Max iterations ({self.max_iterations}) exceeded")
        await self._persist_task(
            RuntimeStatus.FAILED,
            output={"error": "max iterations"},
        )
        return await self._finalize_run(
            sync,
            LoopResult(
                success=False,
                error="Max iterations exceeded",
                iterations=self.iteration,
                retries=self.retry_count,
                events=self.events,
                status=LoopStage.FAILED,
            ),
        )
