"""Dummy secret checker agent to trigger secret prompts."""

from ..base import BaseAgent, AgentResult


class DummySecretChecker(BaseAgent):
    """Agent that does nothing but signals that a secret is required."""

    async def think(self) -> dict:
        return {"analysis": "Checking for required API keys"}

    async def execute(self) -> AgentResult:
        # This agent does no actual work; its purpose is to declare a secret requirement.
        return AgentResult(success=True, output={})

    async def test(self, result: AgentResult) -> AgentResult:
        # Always passes
        return AgentResult(success=True)

    async def repair(self, result: AgentResult):
        # Nothing to repair
        pass