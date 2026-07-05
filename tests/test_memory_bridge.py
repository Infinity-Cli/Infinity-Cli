"""Tests that the Python server persists run events to the shared SQLite DB."""

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from inf.persistence.db import Database
from inf.server.app import app

client = TestClient(app)


@pytest.fixture
def memory_path(tmp_path, monkeypatch):
    """Use an isolated Infinity memory directory for each test."""
    path = tmp_path / "memory"
    path.mkdir()
    monkeypatch.setenv("INFINITY_MEMORY_PATH", str(path))
    # Reset any cached module state that may have read the env var earlier.
    monkeypatch.setattr(
        "inf.persistence.db._default_database_url",
        lambda: f"sqlite+aiosqlite:///{path.as_posix()}/memory.db",
    )
    return path


async def _count_run_events(run_id: str) -> tuple[int, int]:
    db = Database()
    await db.initialize()
    try:
        task_rows = await db.fetchall(
            "SELECT COUNT(*) FROM tasks WHERE run_id = ?;", (run_id,)
        )
        log_rows = await db.fetchall(
            "SELECT COUNT(*) FROM execution_logs WHERE run_id = ?;", (run_id,)
        )
        return task_rows[0][0], log_rows[0][0]
    finally:
        await db.close()


def test_run_persists_task_and_log_rows(memory_path) -> None:
    """Calling /run should write a task and log row for the run."""
    mock_summary = {
        "success": True,
        "goal": "memory bridge goal",
        "completed": ["agent1"],
        "failed": [],
    }

    with patch("inf.server.app.Orchestrator") as mock_orchestrator_class:
        mock_orchestrator = AsyncMock()
        mock_orchestrator.execute_goal = AsyncMock(return_value=mock_summary)
        mock_orchestrator_class.return_value = mock_orchestrator

        with patch("inf.server.app._create_model_router", new_callable=AsyncMock) as mock_router:
            mock_router.return_value = None
            response = client.post("/run", json={"goal": "memory bridge goal"})

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["goal"] == "memory bridge goal"
    assert "run_id" in data
    run_id = data["run_id"]

    task_count, log_count = asyncio.run(_count_run_events(run_id))
    assert task_count >= 1, "Expected at least one task row for the run"
    assert log_count >= 1, "Expected at least one execution log row for the run"


def test_run_uses_shared_memory_path(memory_path) -> None:
    """The Database class resolves the same path used by the TS CLI."""
    db = Database()
    db_path = db._path_from_url()
    assert db_path.parent == memory_path
    assert db_path.name == "memory.db"


def test_failed_run_persists_failed_task(memory_path) -> None:
    """A failed run should persist a failed task and error log."""
    mock_summary = {
        "success": False,
        "goal": "failing memory bridge goal",
        "completed": [],
        "failed": ["agent1"],
    }

    with patch("inf.server.app.Orchestrator") as mock_orchestrator_class:
        mock_orchestrator = AsyncMock()
        mock_orchestrator.execute_goal = AsyncMock(return_value=mock_summary)
        mock_orchestrator_class.return_value = mock_orchestrator

        with patch("inf.server.app._create_model_router", new_callable=AsyncMock) as mock_router:
            mock_router.return_value = None
            response = client.post("/run", json={"goal": "failing memory bridge goal"})

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    run_id = data["run_id"]

    task_count, log_count = asyncio.run(_count_run_events(run_id))
    assert task_count >= 1
    assert log_count >= 1

    db = Database()
    asyncio.run(db.initialize())
    try:
        row = asyncio.run(
            db.fetchone(
                "SELECT status, level FROM tasks t JOIN execution_logs l ON t.run_id = l.run_id "
                "WHERE t.run_id = ? LIMIT 1;",
                (run_id,),
            )
        )
        assert row is not None
        assert row[0] == "failed"
        assert row[1] == "error"
    finally:
        asyncio.run(db.close())
