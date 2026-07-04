"""Documentation specialist agent."""
from typing import Dict, Any
from ..base import AgentResult
from ._base import MinimalSpecialist


class DocsAgent(MinimalSpecialist):
    """Generates project documentation and READMEs."""

    agent_id: str = "docs"
    name: str = "Docs Agent"
    role: str = "technical writer"
    responsibilities: list[str] = [
        "write README files",
        "document APIs",
        "maintain changelogs",
    ]
    tools: list[str] = ["shell", "write", "read", "markdown"]

    async def think(self) -> Dict[str, Any]:
        return {"analysis": f"Writing docs for {self.task_id}", "sections": []}

    async def execute(self) -> AgentResult:
        await self._write_file("README.md", f"# {self.task_id}\n\nGenerated documentation.\n")
        return AgentResult(success=True, files_created=["README.md"])

    async def test(self, result: AgentResult) -> AgentResult:
        if (self.workspace / "README.md").exists():
            return AgentResult(success=True)
        return AgentResult(success=False, error="README not created")
