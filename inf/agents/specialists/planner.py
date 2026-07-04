"""Planner specialist agent."""

from typing import Dict, Any

from ..base import AgentResult
from ._base import MinimalSpecialist


class PlannerAgent(MinimalSpecialist):
    """Plans system architecture and breaks down tasks for other agents."""

    agent_id: str = "planner"
    name: str = "Planner Agent"
    role: str = "planner"
    responsibilities: list[str] = [
        "analyze requirements",
        "produce architecture plans",
        "coordinate task breakdown",
    ]
    tools: list[str] = ["shell", "write", "read", "diagram"]

    async def think(self) -> Dict[str, Any]:
        return {
            "analysis": f"Planning architecture for {self.task_id}",
            "components": ["frontend", "backend", "database"],
            "tech_stack": ["react", "fastapi", "postgresql"],
        }

    async def execute(self) -> AgentResult:
        plan = {
            "task_id": self.task_id,
            "phases": ["design", "implement", "verify"],
        }
        await self._write_file("plan.json", __import__("json").dumps(plan, indent=2))
        return AgentResult(
            success=True,
            output=plan,
            files_created=["plan.json"],
        )

    async def test(self, result: AgentResult) -> AgentResult:
        plan_path = self.workspace / "plan.json"
        if plan_path.exists():
            return AgentResult(success=True)
        return AgentResult(success=False, error="Plan file not created")
