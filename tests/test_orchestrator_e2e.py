"""End-to-end test for the orchestrated swarm run via the CLI."""

import asyncio

import httpx
import pytest
from typer.testing import CliRunner

from inf.cli.main import app
from inf.persistence.db import Database
from inf.persistence.repositories import TaskRepository

runner = CliRunner()


@pytest.fixture
def mock_ollama(monkeypatch):
    """Monkey-patch httpx so the default Ollama client succeeds."""

    def fake_post(self, url, **kwargs):
        return httpx.Response(
            200,
            json={"message": {"content": "mocked-ollama-plan"}},
        )

    async def fake_get(self, url, **kwargs):
        return httpx.Response(
            200,
            json={"models": [{"name": "qwen2.5-coder:7b"}]},
        )

    monkeypatch.setattr("httpx.AsyncClient.post", fake_post)
    monkeypatch.setattr("httpx.AsyncClient.get", fake_get)


def test_run_executes_all_agents_with_mocked_ollama(mock_ollama, tmp_path, monkeypatch):
    """A live ``infinity run`` should drive all registered agents end-to-end."""
    monkeypatch.chdir(tmp_path)

    result = runner.invoke(
        app,
        ["run", "build a simple api", "--no-confirm", "--max-agents", "3"],
    )

    assert result.exit_code == 0, result.output
    assert "Swarm Run: Success" in result.output

    db_path = tmp_path / "infinity.db"
    db = Database(f"sqlite+aiosqlite:///{db_path}")
    asyncio.run(db.initialize())
    try:
        rows = asyncio.run(db.fetchall("SELECT run_id, task_id FROM tasks"))
        assert len(rows) >= 11
    finally:
        asyncio.run(db.close())

    # Confirm agent workspaces were created under the run directory.
    run_workspaces = list((tmp_path / ".infinity" / "runs").iterdir())
    assert run_workspaces


def test_orchestrator_execute_goal_directly(mock_ollama, tmp_path):
    """The orchestrator can be called directly without the CLI wrapper."""
    from inf.core.orchestrator import Orchestrator
    from inf.models.router import ModelRouter

    db = Database(f"sqlite+aiosqlite:///{tmp_path / 'orch.db'}")
    asyncio.run(db.initialize())
    try:
        orchestrator = Orchestrator()
        model_router = ModelRouter()
        summary = asyncio.run(
            orchestrator.execute_goal(
                "direct goal",
                db=db,
                model_router=model_router,
                workspace_root=tmp_path / "work",
                max_agents=2,
                jitter=False,
            )
        )
        assert summary["success"] is True
        assert len(summary["completed"]) == 11
        assert not summary["failed"]

        tasks = asyncio.run(TaskRepository.list_by_run(db, "orchestrator-direct goal"))
        assert len(tasks) == 12  # 11 agents + orchestrator summary
    finally:
        asyncio.run(db.close())
