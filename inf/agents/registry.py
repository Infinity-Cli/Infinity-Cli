"""Agent registry and factory."""

from typing import Type

from .base import BaseAgent
from .specialists.auth import AuthAgent
from .specialists.db import DbAgent
from .specialists.devops import DevopsAgent
from .specialists.docker import DockerAgent
from .specialists.docs import DocsAgent
from .specialists.frontend import FrontendAgent
from .specialists.planner import PlannerAgent
from .specialists.qa import QaAgent
from .specialists.security import SecurityAgent
from .backend import PostgreSQLDBA, RouterAgent

AGENT_REGISTRY: dict[str, Type[BaseAgent]] = {
    "planner": PlannerAgent,
    "frontend": FrontendAgent,
    "db": DbAgent,
    "auth": AuthAgent,
    "security": SecurityAgent,
    "docker": DockerAgent,
    "devops": DevopsAgent,
    "qa": QaAgent,
    "docs": DocsAgent,
    "dba": PostgreSQLDBA,
    "router": RouterAgent,
}


def list_agents() -> list[dict]:
    """Return metadata for every registered agent."""
    return [
        {
            "id": agent_id,
            "name": cls.name,
            "role": cls.role,
            "responsibilities": cls.responsibilities,
            "tools": cls.tools,
        }
        for agent_id, cls in AGENT_REGISTRY.items()
    ]


def create_agent(agent_id: str, **kwargs) -> BaseAgent:
    """Instantiate a registered agent by id."""
    if agent_id not in AGENT_REGISTRY:
        raise KeyError(f"Unknown agent: {agent_id}")
    return AGENT_REGISTRY[agent_id](**kwargs)
