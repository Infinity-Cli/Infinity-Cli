"""Multica-style collaborative multi-agent coordination layer.

Handles message routing, dynamic context sharing, shared team memory databases,
and task handoffs across parallel execution micro-agents.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class MulticaMessage:
    """A standard message structure passed between micro-agents."""
    sender_id: str
    receiver_type: str
    message_type: str  # contract_negotiation, task_handover, schema_sharing, error_alert
    payload: Dict[str, Any]
    timestamp: float = field(default_factory=lambda: 0.0)


class MulticaCollaborationEngine:
    """Coordinates context exchange and agent queues for distributed cognition."""

    def __init__(self):
        self.message_bus: List[MulticaMessage] = []
        self.shared_memory: Dict[str, Any] = {}
        self.queues: Dict[str, asyncio.Queue] = {}

    def register_agent(self, agent_id: str):
        """Register agent with an execution message queue."""
        if agent_id not in self.queues:
            self.queues[agent_id] = asyncio.Queue()

    async def send_message(self, message: MulticaMessage):
        """Route a message to matching queues or store in context bus."""
        self.message_bus.append(message)
        
        # Dispatch to specific queues based on receiving criteria
        for agent_id, q in self.queues.items():
            # If agent_id matches receiver_type or general broadcast
            if message.receiver_type == "broadcast" or message.receiver_type == agent_id:
                await q.put(message)

    async def fetch_messages(self, agent_id: str) -> List[MulticaMessage]:
        """Fetch all queued messages for a specific agent."""
        messages = []
        if agent_id in self.queues:
            q = self.queues[agent_id]
            while not q.empty():
                messages.append(q.get_nowait())
        return messages

    def update_shared_knowledge(self, key: str, value: Any):
        """Update global collaborative memory of the swarm."""
        self.shared_memory[key] = value

    def get_shared_knowledge(self, key: str, default: Any = None) -> Any:
        """Retrieve globally shared parameters, OpenAPI specs, or databases."""
        return self.shared_memory.get(key, default)
