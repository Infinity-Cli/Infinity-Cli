"""Security specialist agent."""
from typing import Dict, Any
from ..base import AgentResult
from ._base import MinimalSpecialist


class SecurityAgent(MinimalSpecialist):
    """Audits code and applies security hardening."""

    agent_id: str = "security"
    name: str = "Security Agent"
    role: str = "security auditor"
    responsibilities: list[str] = [
        "scan for vulnerabilities",
        "apply hardening",
        "review secrets handling",
    ]
    tools: list[str] = ["shell", "write", "read", "scan"]

    async def think(self) -> Dict[str, Any]:
        return {"analysis": f"Auditing security for {self.task_id}", "checks": []}

    async def execute(self) -> AgentResult:
        await self._write_file("security-report.md", "# Security report\n")
        return AgentResult(success=True, files_created=["security-report.md"])

    async def test(self, result: AgentResult) -> AgentResult:
        if (self.workspace / "security-report.md").exists():
            return AgentResult(success=True)
        return AgentResult(success=False, error="Security report not created")
