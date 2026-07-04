"""Tests for the async SQLite persistence layer."""

import tempfile
from pathlib import Path

import pytest

from inf.core.orchestrator import Orchestrator
from inf.persistence.db import Database


@pytest.mark.asyncio
async def test_database_initializes_and_creates_tables():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        db = Database(f"sqlite+aiosqlite:///{db_path}")
        await db.initialize()

        tables = await db.fetchall(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
        )
        table_names = [row[0] for row in tables]
        assert "tasks" in table_names
        assert "agent_states" in table_names
        assert "execution_logs" in table_names
        assert "dag_nodes" in table_names

        await db.close()


@pytest.mark.asyncio
async def test_database_enables_wal():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_wal.db"
        db = Database(f"sqlite+aiosqlite:///{db_path}")
        await db.initialize()

        rows = await db.fetchall("PRAGMA journal_mode;")
        assert rows[0][0].lower() == "wal"

        await db.close()


@pytest.mark.asyncio
async def test_database_creates_files():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_files.db"
        db = Database(f"sqlite+aiosqlite:///{db_path}")
        await db.initialize()

        assert db_path.exists()
        # WAL files exist while the connection is open and writes have occurred.
        assert (Path(tmpdir) / "test_files.db-wal").exists() or (
            Path(tmpdir) / "test_files.db-shm"
        ).exists()

        await db.close()


@pytest.mark.asyncio
async def test_orchestrator_builds_dag_and_sorts():
    orchestrator = Orchestrator()
    orchestrator.build_dag(["plan", "code", "test", "deploy"])
    order = orchestrator.execution_order()
    assert order == ["plan", "code", "test", "deploy"]


@pytest.mark.asyncio
async def test_orchestrator_execute_logs_steps():
    orchestrator = Orchestrator()
    orchestrator.build_dag(["a", "b"])
    order = await orchestrator.execute("ship it")
    assert order == ["a", "b"]
