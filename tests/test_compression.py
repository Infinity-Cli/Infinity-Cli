"""Tests for the Toon-inspired token compression module and integrations."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

from inf.compression import TokenCompressor
from inf.memory.history import TaskHistory
from inf.memory.long_term import LongTermMemory
from inf.memory.short_term import ShortTermMemory
from inf.persistence.db import Database


@pytest.fixture
def compressor() -> TokenCompressor:
    return TokenCompressor()


@pytest_asyncio.fixture
async def db() -> Database:
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "compression.db"
        database = Database(f"sqlite+aiosqlite:///{db_path}")
        await database.initialize()
        try:
            yield database
        finally:
            await database.close()


def test_estimate_tokens_empty_string() -> None:
    assert TokenCompressor.estimate_tokens("") == 1


def test_estimate_tokens_increases_with_length() -> None:
    short_text = "hello world"
    long_text = " ".join(["hello"] * 100)
    assert TokenCompressor.estimate_tokens(long_text) > TokenCompressor.estimate_tokens(short_text)


def test_estimate_tokens_handles_non_string() -> None:
    assert TokenCompressor.estimate_tokens({"key": "value"}) >= 1


def test_compress_text_removes_blank_lines(compressor: TokenCompressor) -> None:
    raw = "line one\n\n\nline two\n  \nline three"
    compressed = compressor.compress(raw)
    assert "\n\n" not in compressed
    assert "line one" in compressed
    assert "line three" in compressed


def test_compress_text_with_small_budget_trims_older_content(compressor: TokenCompressor) -> None:
    raw = "\n".join(f"log line {i}" for i in range(50))
    compressed = compressor.compress(raw, max_tokens=20)
    assert compressed
    assert TokenCompressor.estimate_tokens(compressed) <= 30  # allow small heuristic overshoot
    assert "log line" in compressed


def test_compress_text_preserve_recent(compressor: TokenCompressor) -> None:
    raw = "older one\nolder two\nrecent A\nrecent B"
    compressed = compressor.compress(raw, max_tokens=10, preserve_recent=2)
    assert "recent A" in compressed
    assert "recent B" in compressed
    # Older lines are summarized/kept only if budget permits.
    assert "older one" in compressed or "summarized" in compressed


def test_compress_text_dedupes_repeated_lines(compressor: TokenCompressor) -> None:
    raw = "same\nsame\nsame\ndifferent"
    compressed = compressor.compress(raw)
    assert "same (x3)" in compressed
    assert "different" in compressed


def test_compress_messages_keeps_latest_turns(compressor: TokenCompressor) -> None:
    messages = [
        {"role": "user", "content": "first question"},
        {"role": "assistant", "content": "first answer"},
        {"role": "user", "content": "second question"},
        {"role": "assistant", "content": "second answer"},
    ]
    compressed = compressor.compress_messages(messages, max_tokens=200)
    roles = [m["role"] for m in compressed]
    assert "assistant" in roles
    assert any("second" in str(m.get("content", "")) for m in compressed)


def test_compress_messages_creates_summary_for_old_turns(compressor: TokenCompressor) -> None:
    messages = [
        {"role": "user", "content": f"message {i}"}
        for i in range(20)
    ]
    messages.append({"role": "assistant", "content": "latest answer"})
    compressed = compressor.compress_messages(messages, max_tokens=30)
    summary_present = any("summary" in str(m.get("content", "")).lower() for m in compressed)
    assert summary_present or len(compressed) < len(messages)
    assert any("latest answer" in str(m.get("content", "")) for m in compressed)


def test_compress_messages_preserves_system_messages(compressor: TokenCompressor) -> None:
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "question"},
        {"role": "assistant", "content": "answer"},
    ]
    compressed = compressor.compress_messages(messages, max_tokens=200)
    assert any(m.get("role") == "system" for m in compressed)


def test_compress_messages_empty_input() -> None:
    assert TokenCompressor().compress_messages([]) == []


def test_compress_logs_collapses_repeated_lines(compressor: TokenCompressor) -> None:
    logs = ["INFO: start"] + ["INFO: heartbeat"] * 5 + ["INFO: stop"]
    compressed = compressor.compress_logs(logs)
    assert "INFO: heartbeat (x5)" in compressed
    assert "INFO: start" in compressed
    assert "INFO: stop" in compressed


def test_compress_logs_summarizes_older_entries(compressor: TokenCompressor) -> None:
    logs = [f"log {i}" for i in range(100)]
    compressed = compressor.compress_logs(logs, max_tokens=30)
    assert compressed
    assert TokenCompressor.estimate_tokens(compressed) <= 40
    assert "log" in compressed


def test_compress_logs_empty_list() -> None:
    assert TokenCompressor().compress_logs([]) == ""


def test_compress_value_recurses_into_structure(compressor: TokenCompressor) -> None:
    value = {
        "text": "line one\n\nline two\nline three",
        "nested": {"note": "same\nsame"},
        "count": 42,
    }
    compressed = TokenCompressor.compress_value(value)
    assert compressed["count"] == 42
    assert "\n\n" not in compressed["text"]
    assert "same (x2)" in compressed["nested"]["note"]


@pytest.mark.asyncio
async def test_short_term_memory_compresses_value(db: Database) -> None:
    memory = ShortTermMemory(db)
    long_value = "\n".join(f"line {i}" for i in range(100))
    await memory.add(
        "run-1",
        "state",
        {"content": long_value, "meta": "same\nsame"},
        compress=True,
    )
    fetched = await memory.get("run-1", "state")
    assert fetched is not None
    assert fetched["meta"] == "same (x2)"


@pytest.mark.asyncio
async def test_long_term_memory_compresses_items(db: Database) -> None:
    memory = LongTermMemory(db)
    items = [
        {"role": "user", "content": "\n".join(f"word {i}" for i in range(200))},
        {"role": "assistant", "content": "same\nsame\nsame"},
    ]
    summary = await memory.summarize_and_store(
        "agent-1", "conversation-1", items, compress=True
    )
    assert summary is not None
    assert isinstance(summary, str)
    assert "same" in summary


@pytest.mark.asyncio
async def test_long_term_memory_upsert_summary_alias(db: Database) -> None:
    memory = LongTermMemory(db)
    summary = await memory.upsert_summary("scope", "key", [{"a": 1}], compress=True)
    assert isinstance(summary, str)
    assert await memory.get_summary("scope", "key") == summary


@pytest.mark.asyncio
async def test_task_history_compresses_task_and_outcome(db: Database) -> None:
    history = TaskHistory(db)
    long_task = "\n".join(f"task line {i}" for i in range(50))
    await history.record(
        "run-1",
        "agent-a",
        long_task,
        {"output": "same\nsame", "status": "ok"},
        compress=True,
    )
    entries = await history.get_run_history("run-1")
    assert len(entries) == 1
    assert "same (x2)" in entries[0]["outcome"]["output"]


@pytest.mark.asyncio
async def test_memory_compression_defaults_to_no_compression(db: Database) -> None:
    """Backward compatibility: default compress=False keeps input unchanged."""
    memory = ShortTermMemory(db)
    await memory.add("run", "key", {"text": "same\nsame"})
    assert await memory.get("run", "key") == {"text": "same\nsame"}
