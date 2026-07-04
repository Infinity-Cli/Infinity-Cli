"""Frontend specialist agent."""

from typing import Dict, Any

from ..base import AgentResult
from ._base import MinimalSpecialist


class FrontendAgent(MinimalSpecialist):
    """Builds client-side UI components and pages."""

    agent_id: str = "frontend"
    name: str = "Frontend Agent"
    role: str = "frontend engineer"
    responsibilities: list[str] = [
        "create React components",
        "style user interfaces",
        "wire client-side routing",
    ]
    tools: list[str] = ["shell", "write", "read", "npm"]

    async def think(self) -> Dict[str, Any]:
        return {
            "analysis": f"Designing frontend for {self.task_id}",
            "components": ["App.tsx", "pages/", "components/"],
        }

    async def execute(self) -> AgentResult:
        await self._write_file(
            "src/App.tsx",
            'export default function App() {\n  return <h1>Hello Infinity</h1>;\n}\n',
        )
        return AgentResult(
            success=True,
            output={"files": ["src/App.tsx"]},
            files_created=["src/App.tsx"],
        )

    async def test(self, result: AgentResult) -> AgentResult:
        app_path = self.workspace / "src/App.tsx"
        if app_path.exists() and "Hello Infinity" in app_path.read_text():
            return AgentResult(success=True)
        return AgentResult(success=False, error="Frontend app not created")
