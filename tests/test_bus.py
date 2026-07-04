"""Tests for the agent collaboration message bus."""

import pytest

from inf.agents.bus import BusMessage, MessageBus


@pytest.fixture
def bus() -> MessageBus:
    return MessageBus()


@pytest.mark.asyncio
async def test_publish_subscribe(bus: MessageBus) -> None:
    received = []

    def handler(message: BusMessage) -> None:
        received.append(message)

    bus.subscribe("updates", handler)
    message = await bus.publish("updates", sender="agent-a", payload={"status": "ok"})

    assert len(received) == 1
    assert received[0].id == message.id
    assert received[0].sender == "agent-a"
    assert received[0].channel == "updates"
    assert received[0].payload == {"status": "ok"}
    assert isinstance(received[0].timestamp, float)


@pytest.mark.asyncio
async def test_channel_isolation(bus: MessageBus) -> None:
    received_updates = []
    received_alerts = []

    bus.subscribe("updates", received_updates.append)
    bus.subscribe("alerts", received_alerts.append)

    await bus.publish("updates", sender="agent-a", payload="update-1")
    await bus.publish("alerts", sender="agent-b", payload="alert-1")

    assert len(received_updates) == 1
    assert len(received_alerts) == 1
    assert received_updates[0].payload == "update-1"
    assert received_alerts[0].payload == "alert-1"


@pytest.mark.asyncio
async def test_agent_queue(bus: MessageBus) -> None:
    bus.register_agent("agent-x")

    message = await bus.send_to_agent(
        "agent-x", sender="coordinator", payload={"task": "run"}
    )

    queued = await bus.get_agent_messages("agent-x")
    assert len(queued) == 1
    assert queued[0].id == message.id
    assert queued[0].sender == "coordinator"
    assert queued[0].payload == {"task": "run"}
    assert queued[0].channel == "agent:agent-x"

    assert await bus.get_agent_messages("agent-x") == []


@pytest.mark.asyncio
async def test_shared_state(bus: MessageBus) -> None:
    assert bus.get_shared_state("config") is None
    assert bus.get_shared_state("config", default={}) == {}

    bus.set_shared_state("config", {"batch_size": 16})
    assert bus.get_shared_state("config") == {"batch_size": 16}


@pytest.mark.asyncio
async def test_channel_history(bus: MessageBus) -> None:
    for index in range(10):
        await bus.publish("history", sender="agent", payload=index)

    full_history = bus.get_channel_history("history")
    assert len(full_history) == 10
    assert [msg.payload for msg in full_history] == list(range(10))

    limited_history = bus.get_channel_history("history", limit=3)
    assert len(limited_history) == 3
    assert [msg.payload for msg in limited_history] == [7, 8, 9]

    empty_history = bus.get_channel_history("unknown")
    assert empty_history == []
