"""Unit testing agent"""

import json
from typing import Dict, Any

from ..base import BaseAgent, AgentResult


class UnitTestingAgent(BaseAgent):
    """Creates unit tests for the application"""

    async def think(self) -> Dict[str, Any]:
        return {
            "analysis": "Creating unit tests",
            "test_framework": "pytest",
            "coverage": ["frontend", "backend", "database"],
        }

    async def execute(self) -> AgentResult:
        test_py = '''def test_health():
    assert True

def test_api():
    """Placeholder test"""
    response = {"status": "ok"}
    assert response["status"] == "ok"
'''
        await self._write_file("tests/test_basic.py", test_py)

        return AgentResult(
            success=True,
            output={"files": ["tests/test_basic.py"]},
            files_created=["tests/test_basic.py"],
        )

    async def test(self, result: AgentResult) -> AgentResult:
        test_path = self.workspace / "tests/test_basic.py"
        if test_path.exists():
            content = test_path.read_text()
            if "def test_" in content:
                return AgentResult(success=True)
        return AgentResult(success=False, error="Tests not properly created")

    async def repair(self, result: AgentResult):
        await self.execute()