"""Resilient Infinity-api sync client for runtime status, logs, and commands."""

from __future__ import annotations

import asyncio
import json
import logging
import random
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Optional

import httpx

logger = logging.getLogger(__name__)

websockets: Optional[Any]
try:
    import websockets
except ModuleNotFoundError:  # pragma: no cover
    websockets = None


class SyncClientError(Exception):
    """Raised when a sync API request ultimately fails."""


class SyncClient:
    """HTTP and WebSocket client that synchronizes a runtime with Infinity-api.

    All HTTP push/poll methods are awaitable coroutines so callers can schedule
    them without blocking the autonomous execution loop.  Transient failures
    (5xx responses, network errors, timeouts) are retried with exponential
    backoff and jitter.
    """

    def __init__(
        self,
        base_url: str,
        runtime_id: str,
        api_key: Optional[str] = None,
        client: Optional[httpx.AsyncClient] = None,
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 30.0,
        heartbeat_interval: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.runtime_id = runtime_id
        self.api_key = api_key
        self.client = client or httpx.AsyncClient()
        self._own_client = client is None
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.heartbeat_interval = heartbeat_interval

        self._shutdown = asyncio.Event()
        self._headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            self._headers["Authorization"] = f"Bearer {api_key}"

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------
    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _backoff_delay(self, attempt: int) -> float:
        delay = min(self.base_delay * (2 ** attempt), self.max_delay)
        jitter = random.uniform(0, delay)
        return delay + jitter

    async def _sleep_backoff(self, attempt: int) -> None:
        await asyncio.sleep(self._backoff_delay(attempt))

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = self._url(path)
        headers = {**self._headers, **kwargs.pop("headers", {})}

        for attempt in range(self.max_retries + 1):
            try:
                response = await self.client.request(
                    method, url, headers=headers, **kwargs
                )
            except (httpx.NetworkError, httpx.TimeoutException) as exc:
                if attempt < self.max_retries:
                    logger.warning(
                        "Transient HTTP error on %s %s (attempt %s): %s",
                        method,
                        path,
                        attempt,
                        exc,
                    )
                    await self._sleep_backoff(attempt)
                    continue
                raise SyncClientError(
                    f"HTTP request failed after {self.max_retries} retries: {exc}"
                ) from exc

            if 500 <= response.status_code < 600:
                if attempt < self.max_retries:
                    logger.warning(
                        "Server error %s on %s %s (attempt %s)",
                        response.status_code,
                        method,
                        path,
                        attempt,
                    )
                    await self._sleep_backoff(attempt)
                    continue
                raise SyncClientError(
                    f"HTTP request failed with status {response.status_code}"
                )

            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise SyncClientError(
                    f"HTTP request failed with status {response.status_code}"
                ) from exc

            return response.json()

        # Unreachable, but keeps type checkers happy.
        raise SyncClientError("HTTP request failed")

    # ------------------------------------------------------------------
    # HTTP API
    # ------------------------------------------------------------------
    async def register_runtime(self, metadata: dict) -> dict:
        """Register this runtime with Infinity-api."""
        return await self._request(
            "POST", f"/status/{self.runtime_id}", json=metadata
        )

    async def push_status(self, payload: dict) -> dict:
        """Push a status update for this runtime."""
        return await self._request(
            "POST", f"/status/{self.runtime_id}", json=payload
        )

    async def push_log(self, level: str, message: str, **kwargs: Any) -> dict:
        """Push a log entry to Infinity-api."""
        body = {
            "level": level,
            "message": message,
            "runtime_id": self.runtime_id,
            **kwargs,
        }
        return await self._request("POST", "/logs/", json=body)

    async def push_event(self, event_type: str, data: dict) -> dict:
        """Convenience wrapper that records a structured event as a log entry."""
        return await self.push_log(
            "info",
            f"event: {event_type}",
            event_type=event_type,
            data=data,
            tags=["event"],
        )

    async def poll_commands(self) -> list[dict]:
        """Fetch pending commands from Infinity-api."""
        return await self._request(
            "GET", "/commands/", params={"status": "pending"}
        )

    async def claim_command(self, command_id: str) -> dict:
        """Mark a command as claimed."""
        return await self._request(
            "PATCH", f"/commands/{command_id}", json={"status": "claimed"}
        )

    # ------------------------------------------------------------------
    # WebSocket
    # ------------------------------------------------------------------
    def _websocket_url(self) -> str:
        if self.base_url.startswith("https://"):
            base = self.base_url.replace("https://", "wss://", 1)
        else:
            base = self.base_url.replace("http://", "ws://", 1)
        return f"{base}/ws/{self.runtime_id}"

    async def _heartbeat(self, ws: Any) -> None:
        """Send periodic JSON heartbeat messages while the socket is open."""
        while True:
            try:
                await asyncio.sleep(self.heartbeat_interval)
                await ws.send(
                    json.dumps(
                        {
                            "type": "heartbeat",
                            "runtime_id": self.runtime_id,
                        }
                    )
                )
            except websockets.ConnectionClosed:  # type: ignore[union-attr]
                break
            except asyncio.CancelledError:
                break

    async def _websocket_loop(self, queue: asyncio.Queue[Optional[str]]) -> None:
        """Maintain a WebSocket connection and stream decoded messages into *queue*."""
        attempt = 0
        while True:
            if self._shutdown.is_set():
                break
            try:
                ws_conn: Any = websockets.connect(  # type: ignore[union-attr]
                    self._websocket_url(), additional_headers=self._headers
                )
                if asyncio.iscoroutine(ws_conn):
                    ws_conn = await ws_conn
                async with ws_conn as ws:
                    attempt = 0
                    heartbeat_task = asyncio.create_task(self._heartbeat(ws))
                    try:
                        async for raw in ws:
                            message = raw.decode("utf-8") if isinstance(raw, bytes) else raw
                            await queue.put(message)
                    finally:
                        heartbeat_task.cancel()
                        try:
                            await heartbeat_task
                        except asyncio.CancelledError:
                            pass
            except asyncio.CancelledError:
                break
            except (
                websockets.ConnectionClosed,  # type: ignore[union-attr]
                websockets.InvalidStatus,  # type: ignore[union-attr]
                OSError,
            ) as exc:
                logger.warning("WebSocket connection error: %s", exc)
            except Exception as exc:  # pragma: no cover
                logger.exception("Unexpected WebSocket error: %s", exc)

            if self._shutdown.is_set():
                break
            try:
                await asyncio.sleep(self._backoff_delay(attempt))
            except asyncio.CancelledError:
                break
            attempt = min(attempt + 1, 10)

    @asynccontextmanager
    async def open_websocket(
        self,
    ) -> AsyncGenerator[AsyncGenerator[str, None], None]:
        """Open a resilient WebSocket stream to ``/ws/{runtime_id}``.

        Yields an async iterable that produces incoming text messages.  The
        underlying connection is automatically reconnected with exponential
        backoff after transient failures, and heartbeats are sent periodically.
        """
        if websockets is None:
            raise SyncClientError(
                "WebSocket support requires the 'websockets' package"
            )

        queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
        loop_task = asyncio.create_task(self._websocket_loop(queue))

        async def _stream() -> AsyncGenerator[str, None]:
            while True:
                message = await queue.get()
                if message is None:
                    break
                yield message

        try:
            yield _stream()
        finally:
            self._shutdown.set()
            loop_task.cancel()
            try:
                await loop_task
            except asyncio.CancelledError:
                pass

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def close(self) -> None:
        """Close the underlying HTTP client if it was created by this instance."""
        if self._own_client:
            await self.client.aclose()

    async def __aenter__(self) -> SyncClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()
