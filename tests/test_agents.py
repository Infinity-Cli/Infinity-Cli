"""Tests for the agent registry and specialist agents."""

import pytest

from inf.agents.base import BaseAgent
from inf.agents.registry import AGENT_REGISTRY, create_agent, list_agents


def test_registry_has_ten_agents():
    assert len(AGENT_REGISTRY) >= 10


def test_list_agents_returns_metadata():
    agents = list_agents()
    assert len(agents) == len(AGENT_REGISTRY)
    for meta in agents:
        assert {"id", "name", "role", "responsibilities", "tools"} <= set(meta.keys())


@pytest.mark.asyncio
async def test_all_agents_instantiable(tmp_path):
    for agent_id, cls in AGENT_REGISTRY.items():
        agent = cls(workspace=tmp_path, task_id=f"test-{agent_id}")
        assert isinstance(agent, BaseAgent)
        assert agent.name
        assert agent.role
        assert agent.responsibilities
        assert agent.tools


def test_create_agent_factory(tmp_path):
    agent = create_agent("planner", workspace=tmp_path, task_id="factory-test")
    assert agent.agent_id == "planner"
