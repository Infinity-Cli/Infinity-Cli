"""Docker specialist agent."""
from typing import Dict, Any
from ..base import AgentResult
from ._base import MinimalSpecialist


class DockerAgent(MinimalSpecialist):
    """Builds container images and compose definitions."""

    agent_id: str = "docker"
    name: str = "Docker Agent"
    role: str = "container engineer"
    responsibilities: list[str] = [
        "write Dockerfiles",
        "create compose stacks",
        "optimize images",
    ]
    tools: list[str] = ["shell", "write", "read", "docker"]

    async def think(self) -> Dict[str, Any]:
        return {"analysis": f"Containerizing {self.task_id}", "services": []}

    async def execute(self) -> AgentResult:
        await self._write_file("Dockerfile", "FROM python:3.11-slim\n")
        return AgentResult(success=True, files_created=["Dockerfile"])

    async def test(self, result: AgentResult) -> AgentResult:
        if (self.workspace / "Dockerfile").exists():
            return AgentResult(success=True)
        return AgentResult(success=False, error="Dockerfile not created")
