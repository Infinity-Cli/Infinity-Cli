"""Tests for the autonomous runtime loop engine."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Dict

import pytest
import pytest_asyncio

from inf.agents.base import AgentResult, BaseAgent
from inf.compression import TokenCompressor
from inf.models.base import ModelClient
from inf.models.router import ModelRouter
from inf.persistence.db import Database
from inf.persistence.models import RuntimeStatus
from inf.persistence.repositories import ExecutionLogRepository, TaskRepository
from inf.runtime.loop import AutonomousLoop, LoopGuardError, LoopStage
from inf.runtime.helpers import run_single_agent_loop
from inf.security.sandbox import SandboxValidator
from inf.utils.toon_compressor import ToonCompressor


class FakeAgent(BaseAgent):
    """Programmable fake agent for loop tests."""

    agent_id = "fake"
    name = "Fake Agent"
    role = "tester"

    def __init__(self, workspace: Path, **kwargs: Any):
        super().__init__(workspace=workspace, **kwargs)
        self.thought: Dict[str, Any] = {"analysis": "test"}
        self.execute_results: list[AgentResult] = [AgentResult(success=True, output="ok")]
        self.execute_index = 0
        self.test_results: list[AgentResult] = [AgentResult(success=True)]
        self.test_index = 0
        self.repair_calls: list[AgentResult] = []
        self.repair_side_effect: AgentResult | None = None

    async def think(self) -> Dict[str, Any]:
        return self.thought

    async def execute(self) -> AgentResult:
        result = self.execute_results[self.execute_index]
        self.execute_index = min(self.execute_index + 1, len(self.execute_results) - 1)
        return result

    async def test(self, result: AgentResult) -> AgentResult:
        test_result = self.test_results[self.test_index]
        self.test_index = min(self.test_index + 1, len(self.test_results) - 1)
        return test_result

    async def repair(self, result: AgentResult) -> None:
        self.repair_calls.append(result)
        if self.repair_side_effect is not None:
            self.execute_results.append(self.repair_side_effect)


class NoRepairAgent(FakeAgent):
    """Fake agent without a repair implementation."""

    async def repair(self, result: AgentResult) -> None:
        raise AttributeError("should not be called")


class ThrowingExecuteAgent(FakeAgent):
    """Fake agent whose execute stage raises an exception."""

    async def execute(self) -> AgentResult:
        raise RuntimeError("execute boom")


class DummyProvider(ModelClient):
    """Model provider that echoes a marker."""

    async def chat(self, messages: list, stream: bool = False) -> str:
        return "refined-by-model"

    async def stream(self, messages: list):
        yield "refined-by-model"

    async def validate(self) -> bool:
        return True


@pytest_asyncio.fixture
async def db() -> Database:
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "loop_test.db"
        database = Database(f"sqlite+aiosqlite:///{db_path}")
        await database.initialize()
        try:
            yield database
        finally:
            await database.close()


@pytest.mark.asyncio
async def test_stage_order_success_path(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    loop = AutonomousLoop(agent=agent, jitter=False)

    result = await loop.run()

    assert result.success is True
    assert result.status == LoopStage.COMPLETE
    assert result.iterations == 1
    stages = [event.stage for event in result.events]
    assert LoopStage.THINK in stages
    assert LoopStage.PLAN in stages
    assert LoopStage.EXECUTE in stages
    assert LoopStage.TEST in stages
    assert LoopStage.OBSERVE in stages
    assert LoopStage.COMPLETE in stages


@pytest.mark.asyncio
async def test_retry_caps_then_success(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    agent.execute_results = [
        AgentResult(success=False, error="flaky"),
        AgentResult(success=False, error="flaky"),
        AgentResult(success=True, output="recovered"),
    ]
    loop = AutonomousLoop(agent=agent, max_retries=5, base_backoff=0.01, jitter=False)

    result = await loop.run()

    assert result.success is True
    assert result.retries == 2
    assert result.output == "recovered"
    assert len(agent.repair_calls) == 2


@pytest.mark.asyncio
async def test_max_retries_exceeded(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    agent.execute_results = [AgentResult(success=False, error="permanent")]
    loop = AutonomousLoop(agent=agent, max_retries=2, base_backoff=0.001, jitter=False)

    result = await loop.run()

    assert result.success is False
    assert result.retries == 2
    assert "permanent" in result.error or "max retries" in result.error.lower()


@pytest.mark.asyncio
async def test_max_iteration_guard(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    agent.execute_results = [AgentResult(success=False, error="endless")]
    loop = AutonomousLoop(
        agent=agent,
        max_iterations=3,
        max_retries=10,
        base_backoff=0.001,
        jitter=False,
    )

    result = await loop.run()

    assert result.success is False
    assert result.iterations <= 3
    assert "Max iterations" in result.error


@pytest.mark.asyncio
async def test_cycle_detection_guard(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    agent.execute_results = [AgentResult(success=False, error="same")]
    loop = AutonomousLoop(
        agent=agent,
        max_iterations=20,
        max_retries=10,
        cycle_window=3,
        base_backoff=0.001,
        jitter=False,
    )

    result = await loop.run()

    assert result.success is False
    assert "Cycle detected" in result.error


@pytest.mark.asyncio
async def test_sandbox_rejection_handling(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    sandbox = SandboxValidator(default_workspace=tmp_path)
    # Reject any plan containing "test" token by denying the literal word.
    sandbox.deny("test")
    loop = AutonomousLoop(agent=agent, sandbox=sandbox, jitter=False)

    result = await loop.run()

    assert result.success is False
    assert "Sandbox rejected plan" in result.error


@pytest.mark.asyncio
async def test_repair_fallback_called(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    agent.execute_results = [
        AgentResult(success=False, error="fixable"),
        AgentResult(success=True, output="fixed"),
    ]
    agent.repair_side_effect = AgentResult(success=True, output="fixed")
    loop = AutonomousLoop(agent=agent, max_retries=3, base_backoff=0.001, jitter=False)

    result = await loop.run()

    assert result.success is True
    assert len(agent.repair_calls) == 1
    assert agent.repair_calls[0].error == "fixable"


@pytest.mark.asyncio
async def test_success_path_first_iteration(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    agent.execute_results = [AgentResult(success=True, output="done")]
    loop = AutonomousLoop(agent=agent, jitter=False)

    result = await loop.run()

    assert result.success is True
    assert result.iterations == 1
    assert result.retries == 0
    assert result.output == "done"


@pytest.mark.asyncio
async def test_state_persistence(tmp_path: Path, db: Database):
    agent = FakeAgent(workspace=tmp_path)
    loop = AutonomousLoop(
        agent=agent,
        db=db,
        run_id="run-persist",
        task_id="task-persist",
        jitter=False,
    )

    result = await loop.run()

    assert result.success is True
    task = await TaskRepository.get(db, "run-persist", "task-persist")
    assert task is not None
    assert task.status == RuntimeStatus.COMPLETED
    logs = await ExecutionLogRepository.list_by_run(db, "run-persist")
    assert any("Think" in log.message or log.stage == LoopStage.THINK for log in logs)


@pytest.mark.asyncio
async def test_compression_integration(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    agent.thought = {
        "verbose": "Please write the code carefully.  Make sure to handle exceptions.",
    }
    loop = AutonomousLoop(agent=agent, compressor=ToonCompressor(), jitter=False)

    result = await loop.run()

    assert result.success is True
    assert any("Write optimized code" in event.message for event in result.events)


@pytest.mark.asyncio
async def test_token_compressor_integration(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    agent.thought = {
        "long_text": "word " * 100,
    }
    compressor = TokenCompressor(default_max_tokens=10)
    loop = AutonomousLoop(agent=agent, compressor=compressor, jitter=False)

    result = await loop.run()

    assert result.success is True


@pytest.mark.asyncio
async def test_model_router_integration(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    router = ModelRouter()
    router.register("dummy", DummyProvider(model_name="dummy", base_url="http://dummy"))
    loop = AutonomousLoop(agent=agent, model_router=router, jitter=False)

    result = await loop.run()

    assert result.success is True
    assert agent.thought.get("refined_plan") == "refined-by-model"


@pytest.mark.asyncio
async def test_execute_exception_handled(tmp_path: Path):
    agent = ThrowingExecuteAgent(workspace=tmp_path)
    loop = AutonomousLoop(agent=agent, max_retries=1, base_backoff=0.001, jitter=False)

    result = await loop.run()

    assert result.success is False
    assert "execute boom" in result.error


@pytest.mark.asyncio
async def test_agent_without_repair_method(tmp_path: Path):
    class NoRepairMinimal(BaseAgent):
        agent_id = "no-repair"
        name = "No Repair"

        async def think(self) -> Dict[str, Any]:
            return {}

        async def execute(self) -> AgentResult:
            return AgentResult(success=False, error="missing repair")

        async def test(self, result: AgentResult) -> AgentResult:
            return AgentResult(success=False, error="missing repair")

    agent = NoRepairMinimal(workspace=tmp_path)
    loop = AutonomousLoop(agent=agent, max_retries=1, base_backoff=0.001, jitter=False)

    result = await loop.run()

    assert result.success is False
    assert any("no repair method" in event.message.lower() for event in result.events)


@pytest.mark.asyncio
async def test_backoff_jitter_bounds(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    agent.execute_results = [AgentResult(success=False, error="retry")]
    loop = AutonomousLoop(
        agent=agent,
        max_retries=3,
        base_backoff=1.0,
        max_backoff=10.0,
        jitter=True,
    )

    for retry in range(3):
        loop.retry_count = retry
        delay = loop._backoff_seconds()
        expected_max = min(1.0 * (2 ** retry), 10.0)
        assert delay <= expected_max
        assert delay >= expected_max * 0.5


@pytest.mark.asyncio
async def test_no_jitter_backoff_is_exponential(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    loop = AutonomousLoop(
        agent=agent,
        base_backoff=1.0,
        max_backoff=100.0,
        jitter=False,
    )

    assert loop._backoff_seconds() == 1.0
    loop.retry_count = 1
    assert loop._backoff_seconds() == 2.0
    loop.retry_count = 2
    assert loop._backoff_seconds() == 4.0
    loop.retry_count = 10
    assert loop._backoff_seconds() == 100.0


@pytest.mark.asyncio
async def test_task_status_transitions(tmp_path: Path, db: Database):
    agent = FakeAgent(workspace=tmp_path)
    agent.execute_results = [
        AgentResult(success=False, error="transient"),
        AgentResult(success=True, output="ok"),
    ]
    loop = AutonomousLoop(
        agent=agent,
        db=db,
        run_id="run-transitions",
        task_id="task-transitions",
        max_retries=3,
        base_backoff=0.001,
        jitter=False,
    )

    result = await loop.run()

    assert result.success is True
    task = await TaskRepository.get(db, "run-transitions", "task-transitions")
    assert task.status == RuntimeStatus.COMPLETED
    assert task.retry_count == 1


@pytest.mark.asyncio
async def test_run_single_agent_loop_helper(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    result = await run_single_agent_loop(
        agent,
        max_iterations=5,
        max_retries=2,
        base_backoff=0.001,
        jitter=False,
    )

    assert result.success is True
    assert result.iterations == 1


@pytest.mark.asyncio
async def test_loop_guard_error_raised_by_retry(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    loop = AutonomousLoop(agent=agent, max_retries=0, jitter=False)
    loop.retry_count = 0

    with pytest.raises(LoopGuardError, match="Max retries"):
        await loop.retry()


@pytest.mark.asyncio
async def test_failure_without_error(tmp_path: Path):
    agent = FakeAgent(workspace=tmp_path)
    agent.execute_results = [AgentResult(success=False)]
    loop = AutonomousLoop(agent=agent, max_retries=1, base_backoff=0.001, jitter=False)

    result = await loop.run()

    assert result.success is False
    assert "unknown failure" in result.error
