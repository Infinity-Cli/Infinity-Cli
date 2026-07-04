"""Tests for the async SQLite persistence layer and repositories."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

from inf.persistence.db import Database
from inf.persistence.models import (
    AgentState,
    DAGNode,
    ExecutionLog,
    RuntimeStatus,
    Task,
)
from inf.persistence.repositories import (
    AgentRepository,
    DAGNodeRepository,
    ExecutionLogRepository,
    TaskRepository,
)


@pytest_asyncio.fixture
async def db() -> Database:
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        database = Database(f"sqlite+aiosqlite:///{db_path}")
        await database.initialize()
        try:
            yield database
        finally:
            await database.close()


@pytest.mark.asyncio
async def test_database_initializes_and_creates_tables():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        database = Database(f"sqlite+aiosqlite:///{db_path}")
        await database.initialize()

        tables = await database.fetchall(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
        )
        table_names = [row[0] for row in tables]
        assert "agent_states" in table_names
        assert "tasks" in table_names
        assert "execution_logs" in table_names
        assert "dag_nodes" in table_names
        assert "schema_migrations" in table_names

        await database.close()


@pytest.mark.asyncio
async def test_database_enables_wal():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_wal.db"
        database = Database(f"sqlite+aiosqlite:///{db_path}")
        await database.initialize()

        rows = await database.fetchall("PRAGMA journal_mode;")
        assert rows[0][0].lower() == "wal"

        await database.close()


@pytest.mark.asyncio
async def test_database_creates_files():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_files.db"
        database = Database(f"sqlite+aiosqlite:///{db_path}")
        await database.initialize()

        assert db_path.exists()
        assert (Path(tmpdir) / "test_files.db-wal").exists() or (
            Path(tmpdir) / "test_files.db-shm"
        ).exists()

        await database.close()


@pytest.mark.asyncio
async def test_database_tracks_migrations():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_migrations.db"
        database = Database(f"sqlite+aiosqlite:///{db_path}")
        await database.initialize()

        rows = await database.fetchall(
            "SELECT version FROM schema_migrations ORDER BY version;"
        )
        versions = [row[0] for row in rows]
        assert "001_initial.sql" in versions

        await database.close()


@pytest.mark.asyncio
async def test_agent_repository_create_or_update_and_get(db: Database):
    agent = AgentState(
        agent_id="agent-1",
        role="planner",
        status=RuntimeStatus.PENDING,
        goal="plan a feature",
        payload={"context": "sprint-1"},
    )
    saved = await AgentRepository.create_or_update(db, agent)
    assert saved.id is not None
    assert saved.agent_id == "agent-1"

    fetched = await AgentRepository.get(db, "agent-1")
    assert fetched is not None
    assert fetched.role == "planner"
    assert fetched.payload == {"context": "sprint-1"}

    fetched.goal = "plan a release"
    fetched.status = RuntimeStatus.RUNNING
    updated = await AgentRepository.create_or_update(db, fetched)
    assert updated.goal == "plan a release"
    assert updated.status == RuntimeStatus.RUNNING


@pytest.mark.asyncio
async def test_agent_repository_list_and_delete(db: Database):
    await AgentRepository.create_or_update(
        db, AgentState(agent_id="a", role="coder", status=RuntimeStatus.PENDING)
    )
    await AgentRepository.create_or_update(
        db, AgentState(agent_id="b", role="tester", status=RuntimeStatus.PENDING)
    )

    agents = await AgentRepository.list(db)
    assert len(agents) == 2

    deleted = await AgentRepository.delete(db, "a")
    assert deleted is True
    assert await AgentRepository.get(db, "a") is None

    deleted_again = await AgentRepository.delete(db, "a")
    assert deleted_again is False


@pytest.mark.asyncio
async def test_task_repository_create_and_get(db: Database):
    task = Task(
        task_id="t1",
        run_id="run-1",
        agent_id="agent-1",
        input={"prompt": "hello"},
    )
    created = await TaskRepository.create(db, task)
    assert created.id is not None

    fetched = await TaskRepository.get(db, "run-1", "t1")
    assert fetched is not None
    assert fetched.status == RuntimeStatus.PENDING
    assert fetched.input == {"prompt": "hello"}


@pytest.mark.asyncio
async def test_task_repository_update_status(db: Database):
    await TaskRepository.create(
        db, Task(task_id="t1", run_id="run-1", agent_id="agent-1")
    )

    updated = await TaskRepository.update_status(
        db, "run-1", "t1", RuntimeStatus.COMPLETED, output={"result": "ok"}
    )
    assert updated is True

    fetched = await TaskRepository.get(db, "run-1", "t1")
    assert fetched.status == RuntimeStatus.COMPLETED
    assert fetched.output == {"result": "ok"}
    assert fetched.completed_at is not None


@pytest.mark.asyncio
async def test_task_repository_list_by_agent_and_run(db: Database):
    await TaskRepository.create(
        db, Task(task_id="t1", run_id="run-1", agent_id="agent-a")
    )
    await TaskRepository.create(
        db, Task(task_id="t2", run_id="run-1", agent_id="agent-b")
    )
    await TaskRepository.create(
        db, Task(task_id="t3", run_id="run-2", agent_id="agent-a")
    )

    by_agent = await TaskRepository.list_by_agent(db, "agent-a")
    assert len(by_agent) == 2
    assert {t.task_id for t in by_agent} == {"t1", "t3"}

    by_run = await TaskRepository.list_by_run(db, "run-1")
    assert len(by_run) == 2
    assert {t.task_id for t in by_run} == {"t1", "t2"}


@pytest.mark.asyncio
async def test_execution_log_repository_append_and_list(db: Database):
    log1 = ExecutionLog(
        run_id="run-1", agent_id="agent-a", task_id="t1", level="info", message="start"
    )
    log2 = ExecutionLog(
        run_id="run-1", agent_id="agent-a", task_id="t1", level="error", message="boom"
    )
    log3 = ExecutionLog(
        run_id="run-2", agent_id="agent-b", task_id="t2", level="info", message="ok"
    )

    await ExecutionLogRepository.append(db, log1)
    await ExecutionLogRepository.append(db, log2)
    await ExecutionLogRepository.append(db, log3)

    run_logs = await ExecutionLogRepository.list_by_run(db, "run-1")
    assert len(run_logs) == 2
    assert [log.level for log in run_logs] == ["info", "error"]

    agent_logs = await ExecutionLogRepository.list_by_agent(db, "agent-b")
    assert len(agent_logs) == 1
    assert agent_logs[0].message == "ok"


@pytest.mark.asyncio
async def test_dag_node_repository_create_and_order(db: Database):
    nodes = [
        DAGNode(node_id="deploy", dependencies=["test"]),
        DAGNode(node_id="code", dependencies=["plan"]),
        DAGNode(node_id="test", dependencies=["code"]),
        DAGNode(node_id="plan", dependencies=[]),
    ]
    saved = await DAGNodeRepository.create_nodes_for_run(db, "run-1", nodes)
    assert len(saved) == 4

    order = await DAGNodeRepository.get_execution_order(db, "run-1")
    assert order == ["plan", "code", "test", "deploy"]


@pytest.mark.asyncio
async def test_dag_node_repository_update_status(db: Database):
    nodes = [DAGNode(node_id="n1", dependencies=[])]
    await DAGNodeRepository.create_nodes_for_run(db, "run-1", nodes)

    updated = await DAGNodeRepository.update_status(
        db, "run-1", "n1", RuntimeStatus.RUNNING
    )
    assert updated is True

    all_nodes = await DAGNodeRepository.list_by_run(db, "run-1")
    assert all_nodes[0].status == RuntimeStatus.RUNNING


@pytest.mark.asyncio
async def test_dag_node_repository_cycle_detection(db: Database):
    nodes = [
        DAGNode(node_id="a", dependencies=["b"]),
        DAGNode(node_id="b", dependencies=["a"]),
    ]
    await DAGNodeRepository.create_nodes_for_run(db, "cycle-run", nodes)

    with pytest.raises(ValueError, match="Cycle detected"):
        await DAGNodeRepository.get_execution_order(db, "cycle-run")


@pytest.mark.asyncio
async def test_database_fetchone(db: Database):
    row = await db.fetchone(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?;",
        ("agent_states",),
    )
    assert row is not None
    assert row[0] == "agent_states"

    missing = await db.fetchone(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?;",
        ("nonexistent",),
    )
    assert missing is None
