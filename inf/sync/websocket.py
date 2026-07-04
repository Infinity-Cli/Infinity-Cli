"""WebSocket server for streaming realtime agent status to Android companion app"""

import asyncio
import json
from typing import Any, Set
import websockets
from rich.console import Console

console = Console()


class MobileSyncServer:
    """Mobile synchronization server using WebSockets."""

    def __init__(self, host: str = "localhost", port: int = 8765):
        self.host = host
        self.port = port
        self.clients: Set[websockets.WebSocketServerProtocol] = set()  # type: ignore[name-defined]
        self.server = None
        self._latest_state: dict[str, Any] = {}

    async def register(self, websocket):
        """Add newly connected client and push the current state."""
        self.clients.add(websocket)
        console.print(f"[dim][WS Sync][/dim] Android Companion App connected from {websocket.remote_address}")
        # Send initial state
        await websocket.send(json.dumps({
            "type": "sync_state",
            "payload": self._latest_state
        }))

    async def unregister(self, websocket):
        """Remove disconnected client."""
        self.clients.remove(websocket)
        console.print("[dim][WS Sync][/dim] Android Companion App disconnected")

    async def handler(self, websocket):
        """Client connection lifecycle handler."""
        await self.register(websocket)
        try:
            async for message in websocket:
                # Handle potential remote control messages from companion app
                try:
                    data = json.loads(message)
                    if data.get("type") == "ping":
                        await websocket.send(json.dumps({"type": "pong"}))
                except json.JSONDecodeError:
                    pass
        except websockets.ConnectionClosed:
            pass
        finally:
            await self.unregister(websocket)

    async def start(self):
        """Start the WebSocket broadcast server."""
        self.server = await websockets.serve(self.handler, self.host, self.port)
        console.print(f"[bold green][WS Sync][/bold green] Server listening on ws://{self.host}:{self.port}")

    async def stop(self):
        """Shutdown the WebSocket server."""
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    async def broadcast_state(self, state: dict):
        """Broadcast updated execution/swarm state to all connected mobile clients."""
        self._latest_state = state
        if not self.clients:
            return
        
        payload = json.dumps({
            "type": "state_update",
            "payload": state
        })
        # Execute broadcasts in parallel
        await asyncio.gather(
            *[client.send(payload) for client in self.clients],
            return_exceptions=True
        )
