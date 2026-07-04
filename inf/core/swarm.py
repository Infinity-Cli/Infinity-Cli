"""Multi-agent swarm management and spawning"""

from typing import Optional, List, Dict
from pathlib import Path

from ..agents.base import BaseAgent
from ..agents.planner.architect import SystemArchitect
from ..agents.frontend.react import ReactSpecialist
from ..agents.backend.router import RouterAgent
from ..agents.backend.database import PostgreSQLDBA
from ..agents.qa.testing import UnitTestingAgent
from ..agents.planner.secret import DummySecretChecker
from ..utils.multica_collaboration import MulticaCollaborationEngine


AGENT_TYPES = {
    "SystemArchitect": SystemArchitect,
    "ReactSpecialist": ReactSpecialist,
    "RouterAgent": RouterAgent,
    "PostgreSQLDBA": PostgreSQLDBA,
    "UnitTestingAgent": UnitTestingAgent,
    "DummySecretChecker": DummySecretChecker,
}


class SwarmManager:
    """Dynamic agent spawning and lifecycle management"""

    def __init__(self):
        self._agents: Dict[str, BaseAgent] = {}
        # Team coordination shared bus
        self.collab_engine = MulticaCollaborationEngine()

    async def spawn_agents(self, dag: dict, workspace: Path) -> List[BaseAgent]:
        """Spawn specialized agents based on DAG nodes"""
        agents = []

        for node in dag.get("nodes", []):
            agent_type = node.get("type")
            agent_cls = AGENT_TYPES.get(agent_type)

            if not agent_cls:
                continue

            agent = agent_cls(  # type: ignore[abstract]
                workspace=workspace / node["id"],
                task_id=node["id"],
                args=node.get("args", {}),
                collab_engine=self.collab_engine,
            )
            self._agents[node["id"]] = agent
            agents.append(agent)

        return agents

    async def spawn_agent_by_type(
        self, agent_type: str, workspace: Path, **kwargs
    ) -> Optional[BaseAgent]:
        """Dynamically spawn an agent by type name"""
        agent_cls = AGENT_TYPES.get(agent_type)
        if not agent_cls:
            return None

        kwargs.setdefault("collab_engine", self.collab_engine)
        agent = agent_cls(workspace=workspace, **kwargs)  # type: ignore[abstract]
        self._agents[agent.id] = agent
        return agent

    def get_agent(self, task_id: str) -> Optional[BaseAgent]:
        """Get an agent by its task ID"""
        return self._agents.get(task_id)

    def get_all_agents(self) -> List[BaseAgent]:
        """Get all spawned agents"""
        return list(self._agents.values())

    async def pause_agent(self, task_id: str, reason: str = ""):
        """Pause an agent gracefully (e.g., waiting for secrets)"""
        agent = self._agents.get(task_id)
        if agent:
            agent.status = "paused"
            agent.pause_reason = reason

    async def resume_agent(self, task_id: str):
        """Resume a paused agent"""
        agent = self._agents.get(task_id)
        if agent and agent.status == "paused":
            agent.status = "waiting"