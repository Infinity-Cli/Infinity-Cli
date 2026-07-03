"""System architect agent for architecture planning"""

import json
from typing import Dict, Any

from ..base import BaseAgent, AgentResult


class SystemArchitect(BaseAgent):
    """Analyzes goals and generates system architecture plans"""

    async def think(self) -> Dict[str, Any]:
        return {
            "analysis": f"Analyzing: {self.args.get('goal', 'unknown')}",
            "components": ["frontend", "backend", "database"],
            "tech_stack": ["react", "fastapi", "postgresql"],
        }

    async def execute(self) -> AgentResult:
        architecture = {
            "frontend": {"type": "ReactSpecialist", "depends_on": []},
            "backend": {"type": "RouterAgent", "depends_on": ["frontend"]},
            "database": {"type": "PostgreSQLDBA", "depends_on": ["backend"]},
        }

        await self._write_file("architecture.json", json.dumps(architecture, indent=2))

        return AgentResult(success=True, output=architecture)

    async def test(self, result: AgentResult) -> AgentResult:
        contract_path = self.workspace / "architecture.json"
        if contract_path.exists():
            return AgentResult(success=True)
        return AgentResult(success=False, error="Architecture file not created")

    async def repair(self, result: AgentResult):
        await self._write_file("architecture.json", json.dumps(
            {"frontend": {}, "backend": {}, "database": {}}, indent=2
        ))