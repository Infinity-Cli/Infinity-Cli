"""Tests for the Infinity-api sync client."""

from __future__ import annotations

import asyncio
import json
from contextlib import suppress
from typing import Any, Optional
from unittest.mock import AsyncMock

import httpx
import pytest
import websockets

from inf.sync.api_client import SyncClient, SyncClientError


def _resp(status: int, body: Any | None = None) -> httpx.Response:
    """Build an ``httpx.Response`` with the given status and JSON body."""
    request = httpx.Request("GET", "http://example.com")
    return httpx.Response(status_code=status, json=body, request=request)


@pytest.fixture
def make_client():
    """Factory that creates a ``SyncClient`` wired to a mocked ``httpx.AsyncClient``."""

    def _make(**kwargs: Any) -> tuple[SyncClient, AsyncMock]:
        mock_client = AsyncMock(spec=httpx.AsyncClient)
        client = SyncClient(
            "http://api.example.com",
            "rt-123",
            api_key="secret",
            client=mock_client,
            **kwargs,
        )
        return client, mock_client

    return _make


@pytest.fixture
def capture_sleep(monkeypatch):
    """Capture delays passed to ``asyncio.sleep`` during a test."""
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    return sleeps


@pytest.mark.asyncio
async def test_register_runtime_posts_metadata(make_client):
    client, mock = make_client()
    mock.request.return_value = _resp(200, {"registered": True})

    result = await client.register_runtime({"version": "1.0", "host": "local"})

    assert result == {"registered": True}
    mock.request.assert_awaited_once()
    args, kwargs = mock.request.await_args
    assert args[0] == "POST"
    assert args[1].endswith("/status/rt-123")
    assert kwargs["json"] == {"version": "1.0", "host": "local"}
    assert kwargs["headers"]["Authorization"] == "Bearer secret"


@pytest.mark.asyncio
async def test_push_status(make_client):
    client, mock = make_client()
    mock.request.return_value = _resp(200, {"ok": True})

    result = await client.push_status({"stage": "running", "progress": 42})

    assert result == {"ok": True}
    args, kwargs = mock.request.await_args
    assert args[0] == "POST"
    assert args[1].endswith("/status/rt-123")
    assert kwargs["json"] == {"stage": "running", "progress": 42}


@pytest.mark.asyncio
async def test_push_log_includes_runtime_id_and_kwargs(make_client):
    client, mock = make_client()
    mock.request.return_value = _resp(200, {"ok": True})

    result = await client.push_log(
        "warning", "disk low", component="sandbox", extra={"free": 5}
    )

    assert result == {"ok": True}
    args, kwargs = mock.request.await_args
    assert args[0] == "POST"
    assert args[1].endswith("/logs/")
    assert kwargs["json"] == {
        "level": "warning",
        "message": "disk low",
        "runtime_id": "rt-123",
        "component": "sandbox",
        "extra": {"free": 5},
    }


@pytest.mark.asyncio
async def test_push_event_wraps_log(make_client):
    client, mock = make_client()
    mock.request.return_value = _resp(200, {"ok": True})

    result = await client.push_event("agent.completed", {"agent_id": "a1"})

    assert result == {"ok": True}
    args, kwargs = mock.request.await_args
    assert args[0] == "POST"
    assert args[1].endswith("/logs/")
    body = kwargs["json"]
    assert body["level"] == "info"
    assert body["event_type"] == "agent.completed"
    assert body["data"] == {"agent_id": "a1"}
    assert body["tags"] == ["event"]


@pytest.mark.asyncio
async def test_poll_commands_uses_pending_query(make_client):
    client, mock = make_client()
    mock.request.return_value = _resp(200, [{"id": "cmd-1", "action": "pause"}])

    result = await client.poll_commands()

    assert result == [{"id": "cmd-1", "action": "pause"}]
    args, kwargs = mock.request.await_args
    assert args[0] == "GET"
    assert args[1].endswith("/commands/")
    assert kwargs["params"] == {"status": "pending"}


@pytest.mark.asyncio
async def test_claim_command_patches_status(make_client):
    client, mock = make_client()
    mock.request.return_value = _resp(200, {"id": "cmd-1", "status": "claimed"})

    result = await client.claim_command("cmd-1")

    assert result == {"id": "cmd-1", "status": "claimed"}
    args, kwargs = mock.request.await_args
    assert args[0] == "PATCH"
    assert args[1].endswith("/commands/cmd-1")
    assert kwargs["json"] == {"status": "claimed"}


@pytest.mark.asyncio
async def test_http_retry_5xx_then_success(make_client, capture_sleep):
    client, mock = make_client(max_retries=2, base_delay=0.5)
    mock.request.side_effect = [_resp(503), _resp(200, {"id": "rt-123"})]

    result = await client.register_runtime({"version": "1.0"})

    assert result == {"id": "rt-123"}
    assert mock.request.await_count == 2
    assert len(capture_sleep) == 1
    assert 0.5 <= capture_sleep[0] <= 1.0


@pytest.mark.asyncio
async def test_http_retry_network_error_then_success(make_client, capture_sleep):
    client, mock = make_client(max_retries=2, base_delay=0.25)
    mock.request.side_effect = [httpx.ConnectError("offline"), _resp(200, {"ok": True})]

    result = await client.push_status({"stage": "idle"})

    assert result == {"ok": True}
    assert mock.request.await_count == 2
    assert len(capture_sleep) == 1


@pytest.mark.asyncio
async def test_no_retry_for_client_errors(make_client):
    client, mock = make_client(max_retries=2)
    mock.request.return_value = _resp(404, {"detail": "not found"})

    with pytest.raises(SyncClientError):
        await client.push_status({"stage": "idle"})

    assert mock.request.await_count == 1


@pytest.mark.asyncio
async def test_backoff_jitter_bounded(make_client, capture_sleep):
    client, mock = make_client(max_retries=3, base_delay=1.0)
    mock.request.side_effect = [
        _resp(500),
        _resp(502),
        _resp(503),
        _resp(200, {"recovered": True}),
    ]

    await client.push_status({"stage": "idle"})

    assert mock.request.await_count == 4
    assert len(capture_sleep) == 3
    for attempt, delay in enumerate(capture_sleep):
        base = 1.0 * (2 ** attempt)
        assert base <= delay <= base * 2


@pytest.mark.asyncio
async def test_close_closes_owned_client(monkeypatch):
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda: mock_client
    )
    client = SyncClient("http://api.example.com", "rt-123")

    await client.close()

    mock_client.aclose.assert_awaited_once()


@pytest.mark.asyncio
async def test_close_skips_externally_provided_client(make_client):
    client, mock = make_client()

    await client.close()

    mock.aclose.assert_not_awaited()


class _FakeWebSocket:
    """Minimal fake WebSocket connection for unit tests."""

    def __init__(
        self, messages: list[str], block_on_receive: bool = False
    ) -> None:
        self.messages = list(messages)
        self.sent: list[str] = []
        self.block_on_receive = block_on_receive

    async def __aenter__(self) -> _FakeWebSocket:
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    def __aiter__(self) -> _FakeWebSocket:
        return self

    async def __anext__(self) -> str:
        if self.block_on_receive:
            await asyncio.Event().wait()
        if not self.messages:
            raise StopAsyncIteration
        return self.messages.pop(0)

    async def send(self, message: str) -> None:
        self.sent.append(message)

    async def close(self) -> None:
        pass


@pytest.fixture
def fast_sleep(monkeypatch):
    """Patch ``asyncio.sleep`` to record delays and yield control once."""
    sleeps: list[float] = []
    real_sleep = asyncio.sleep

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)
        await real_sleep(0)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    return sleeps


@pytest.mark.asyncio
async def test_websocket_loop_streams_messages(monkeypatch, fast_sleep):
    calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    fake_ws = _FakeWebSocket(["hello", "world"])

    async def fake_connect(*args: Any, **kwargs: Any) -> _FakeWebSocket:
        calls.append((args, kwargs))
        return fake_ws

    monkeypatch.setattr(websockets, "connect", fake_connect)

    client = SyncClient(
        "http://api.example.com",
        "rt-123",
        api_key="secret",
        heartbeat_interval=60.0,
    )
    queue: asyncio.Queue[Optional[str]] = asyncio.Queue()

    task = asyncio.create_task(client._websocket_loop(queue))
    message1 = await asyncio.wait_for(queue.get(), timeout=1.0)
    message2 = await asyncio.wait_for(queue.get(), timeout=1.0)

    client._shutdown.set()
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task

    assert message1 == "hello"
    assert message2 == "world"
    assert queue.empty()
    assert fake_ws.sent == []
    assert len(calls) >= 1
    assert calls[0][0][0].endswith("/ws/rt-123")
    assert calls[0][1]["additional_headers"]["Authorization"] == "Bearer secret"


@pytest.mark.asyncio
async def test_websocket_loop_reconnects_after_connection_closed(
    monkeypatch, fast_sleep
):
    attempts: list[str] = []
    fake_ws = _FakeWebSocket(["back online"])

    async def fake_connect(*args: Any, **kwargs: Any) -> _FakeWebSocket:
        if not attempts:
            attempts.append("fail")
            raise websockets.ConnectionClosed(
                websockets.Close(1006, "unexpected"), None
            )
        attempts.append("success")
        return fake_ws

    monkeypatch.setattr(websockets, "connect", fake_connect)

    client = SyncClient(
        "http://api.example.com",
        "rt-123",
        base_delay=0.0,
        max_delay=0.0,
        heartbeat_interval=60.0,
    )
    queue: asyncio.Queue[Optional[str]] = asyncio.Queue()

    task = asyncio.create_task(client._websocket_loop(queue))
    message = await asyncio.wait_for(queue.get(), timeout=1.0)

    client._shutdown.set()
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task

    assert message == "back online"
    assert attempts[0] == "fail"
    assert "success" in attempts


@pytest.mark.asyncio
async def test_websocket_loop_sends_heartbeat(monkeypatch, fast_sleep):
    fake_ws = _FakeWebSocket([], block_on_receive=True)

    async def fake_connect(*args: Any, **kwargs: Any) -> _FakeWebSocket:
        return fake_ws

    monkeypatch.setattr(websockets, "connect", fake_connect)

    client = SyncClient(
        "http://api.example.com", "rt-123", heartbeat_interval=0.01
    )
    queue: asyncio.Queue[Optional[str]] = asyncio.Queue()

    task = asyncio.create_task(client._websocket_loop(queue))
    for _ in range(20):
        await asyncio.sleep(0)

    client._shutdown.set()
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task

    heartbeats = [json.loads(m) for m in fake_ws.sent]
    assert any(beat.get("type") == "heartbeat" for beat in heartbeats)
    assert all(beat.get("runtime_id") == "rt-123" for beat in heartbeats)


@pytest.mark.asyncio
async def test_websocket_optional_without_websockets(monkeypatch):
    monkeypatch.setattr("inf.sync.api_client.websockets", None)
    client = SyncClient("http://api.example.com", "rt-123")

    with pytest.raises(SyncClientError, match="websockets"):
        async with client.open_websocket():
            pass  # pragma: no cover
