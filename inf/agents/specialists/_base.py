"""Minimal concrete base for simple specialist agents."""

from typing import Dict, Any

from ..base import BaseAgent, AgentResult


class MinimalSpecialist(BaseAgent):
    """Concrete base class providing default no-op implementations.

    Specialist agents with simple responsibilities can subclass this and
    only override behaviour when needed.
    """

    agent_id: str = "minimal"
    name: str = "Minimal Specialist"
    role: str = "specialist"
    responsibilities: list[str] = ["assist with assigned tasks"]
    tools: list[str] = ["shell", "write", "read"]

    async def think(self) -> Dict[str, Any]:
        return {"analysis": f"{self.name} is ready", "task_id": self.task_id}

    async def execute(self) -> AgentResult:
        return AgentResult(success=True, output={"agent": self.agent_id})

    async def test(self, result: AgentResult) -> AgentResult:
        return AgentResult(success=True)

    async def repair(self, result: AgentResult) -> None:
        pass
