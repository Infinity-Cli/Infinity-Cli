"""Tests for the memory layer: short-term, long-term, vector, and task history."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

from inf.memory.history import TaskHistory
from inf.memory.long_term import LongTermMemory
from inf.memory.short_term import ShortTermMemory
from inf.memory.vector import VectorMemory
from inf.persistence.db import Database


@pytest_asyncio.fixture
async def db() -> Database:
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "memory.db"
        database = Database(f"sqlite+aiosqlite:///{db_path}")
        await database.initialize()
        try:
            yield database
        finally:
            await database.close()


@pytest.mark.asyncio
async def test_database_applies_memory_migration(db: Database) -> None:
    rows = await db.fetchall(
        "SELECT version FROM schema_migrations ORDER BY version;"
    )
    versions = {row[0] for row in rows}
    assert "001_initial.sql" in versions
    assert "002_memory.sql" in versions

    tables = await db.fetchall(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
    )
    table_names = {row[0] for row in tables}
    assert "short_term_memory" in table_names
    assert "long_term_memory" in table_names
    assert "task_history" in table_names


@pytest.mark.asyncio
async def test_short_term_memory_add_get_list_clear(db: Database) -> None:
    memory = ShortTermMemory(db)

    await memory.add("run-1", "state", {"foo": "bar"})
    value = await memory.get("run-1", "state")
    assert value == {"foo": "bar"}

    missing = await memory.get("run-1", "missing")
    assert missing is None

    await memory.add("run-1", "state-2", {"baz": 42})
    recent = await memory.list_recent("run-1")
    assert len(recent) == 2
    assert {entry["key"] for entry in recent} == {"state", "state-2"}
    assert all("value" in entry for entry in recent)

    await memory.clear("run-1")
    assert await memory.get("run-1", "state") is None
    assert await memory.list_recent("run-1") == []


@pytest.mark.asyncio
async def test_long_term_memory_summary_and_facts(db: Database) -> None:
    memory = LongTermMemory(db)
    items = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi"},
    ]

    summary = await memory.summarize_and_store("agent-1", "conversation-1", items)
    assert summary is not None
    assert isinstance(summary, str)

    fetched = await memory.get_summary("agent-1", "conversation-1")
    assert fetched == summary

    missing = await memory.get_summary("agent-1", "missing")
    assert missing is None

    await memory.store_fact("agent-1", "The user prefers Python.")
    await memory.store_fact("agent-1", "The user likes pytest.")
    facts = await memory.recall_facts("agent-1")
    assert len(facts) == 2
    assert any("Python" in fact for fact in facts)
    assert any("pytest" in fact for fact in facts)

    limited = await memory.recall_facts("agent-1", limit=1)
    assert len(limited) == 1


@pytest.mark.asyncio
async def test_long_term_memory_upserts_summary(db: Database) -> None:
    memory = LongTermMemory(db)
    first = await memory.summarize_and_store("scope", "key", [{"a": 1}])
    second = await memory.summarize_and_store("scope", "key", [{"a": 2}])
    assert second != first
    assert await memory.get_summary("scope", "key") == second


def test_vector_memory_add_query() -> None:
    memory = VectorMemory(collection_name="test_infinity_memory")
    memory.add("doc-1", "banana split recipe", {"source": "recipes"})
    memory.add("doc-2", "rocket launch sequence", {"source": "space"})

    results = memory.query("banana", n_results=2)
    assert len(results) <= 2
    ids = {result["id"] for result in results}
    assert "doc-1" in ids

    for result in results:
        assert "document" in result
        assert "metadata" in result
        assert "distance" in result


def test_vector_memory_query_returns_added_documents() -> None:
    memory = VectorMemory(collection_name="test_infinity_memory_two")
    assert memory.query("anything") == []

    memory.add("id-1", "the quick brown fox", {"tag": "animals"})
    results = memory.query("quick")
    assert len(results) == 1
    assert results[0]["id"] == "id-1"
    assert results[0]["metadata"] == {"tag": "animals"}


@pytest.mark.asyncio
async def test_task_history_record_and_query(db: Database) -> None:
    history = TaskHistory(db)

    await history.record(
        "run-1", "agent-a", "plan", {"status": "success", "output": "plan.txt"}
    )
    await history.record(
        "run-1", "agent-b", "code", {"status": "failure", "error": "timeout"}
    )
    await history.record(
        "run-2", "agent-a", "test", {"status": "success"}
    )

    run_history = await history.get_run_history("run-1")
    assert len(run_history) == 2
    assert {entry["agent_id"] for entry in run_history} == {"agent-a", "agent-b"}
    assert run_history[0]["task"] == "plan"

    agent_history = await history.get_agent_history("agent-a")
    assert len(agent_history) == 2
    assert agent_history[0]["run_id"] == "run-2"
    assert agent_history[0]["outcome"]["status"] == "success"

    limited = await history.get_agent_history("agent-a", limit=1)
    assert len(limited) == 1
