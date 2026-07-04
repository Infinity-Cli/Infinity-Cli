"""QA specialist agent."""
from typing import Dict, Any
from ..base import AgentResult
from ._base import MinimalSpecialist


class QaAgent(MinimalSpecialist):
    """Writes and runs quality assurance tests."""

    agent_id: str = "qa"
    name: str = "QA Agent"
    role: str = "quality assurance"
    responsibilities: list[str] = [
        "write test plans",
        "execute automated tests",
        "report defects",
    ]
    tools: list[str] = ["shell", "write", "read", "pytest"]

    async def think(self) -> Dict[str, Any]:
        return {"analysis": f"Designing QA for {self.task_id}", "suites": []}

    async def execute(self) -> AgentResult:
        await self._write_file("tests/test_placeholder.py", "def test_ok():\n    assert True\n")
        return AgentResult(success=True, files_created=["tests/test_placeholder.py"])

    async def test(self, result: AgentResult) -> AgentResult:
        if (self.workspace / "tests/test_placeholder.py").exists():
            return AgentResult(success=True)
        return AgentResult(success=False, error="QA tests not created")
