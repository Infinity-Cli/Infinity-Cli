"""In-memory message bus for agent collaboration and shared state channels."""

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from inf.utils.multica_collaboration import MulticaCollaborationEngine


@dataclass
class BusMessage:
    """A lightweight message transmitted over the agent message bus."""

    sender: str
    channel: str
    payload: Any
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: float = field(default_factory=time.time)
    correlation_id: Optional[str] = None


class MessageBus:
    """Simple in-memory publish/subscribe bus with per-agent queues and shared state."""

    def __init__(self) -> None:
        self._engine = MulticaCollaborationEngine()
        self._subscribers: Dict[str, List[Callable[[BusMessage], Any]]] = {}
        self._history: Dict[str, List[BusMessage]] = {}

    def subscribe(self, channel: str, callback: Callable[[BusMessage], Any]) -> None:
        """Register a callback to be invoked when a message is published to ``channel``."""
        self._subscribers.setdefault(channel, []).append(callback)

    async def publish(
        self,
        channel: str,
        sender: str,
        payload: Any,
        correlation_id: Optional[str] = None,
    ) -> BusMessage:
        """Publish a message to ``channel`` and notify all subscribers."""
        message = BusMessage(
            sender=sender,
            channel=channel,
            payload=payload,
            correlation_id=correlation_id,
        )

        self._history.setdefault(channel, []).append(message)

        for subscriber in self._subscribers.get(channel, []):
            result = subscriber(message)
            if asyncio.iscoroutine(result):
                await result

        return message

    def register_agent(self, agent_id: str) -> None:
        """Create a dedicated message queue for ``agent_id``."""
        self._engine.register_agent(agent_id)

    async def send(self, agent_id: str, message: BusMessage) -> None:
        """Place ``message`` on the queue for ``agent_id``."""
        self._engine.register_agent(agent_id)
        await self._engine.queues[agent_id].put(message)

    async def send_to_agent(
        self,
        agent_id: str,
        sender: str,
        payload: Any,
        correlation_id: Optional[str] = None,
    ) -> BusMessage:
        """Build and send a ``BusMessage`` to ``agent_id``."""
        message = BusMessage(
            sender=sender,
            channel=f"agent:{agent_id}",
            payload=payload,
            correlation_id=correlation_id,
        )
        await self.send(agent_id, message)
        return message

    async def get_agent_messages(self, agent_id: str) -> List[BusMessage]:
        """Drain all queued messages for ``agent_id``."""
        messages: List[BusMessage] = []
        if agent_id in self._engine.queues:
            queue = self._engine.queues[agent_id]
            while not queue.empty():
                messages.append(queue.get_nowait())
        return messages

    def set_shared_state(self, key: str, value: Any) -> None:
        """Store ``value`` in shared memory under ``key``."""
        self._engine.update_shared_knowledge(key, value)

    def get_shared_state(self, key: str, default: Any = None) -> Any:
        """Retrieve ``key`` from shared memory, returning ``default`` if absent."""
        return self._engine.get_shared_knowledge(key, default)

    def get_channel_history(
        self, channel: str, limit: int = 50
    ) -> List[BusMessage]:
        """Return the most recent ``limit`` messages published to ``channel``."""
        return self._history.get(channel, [])[-limit:]
