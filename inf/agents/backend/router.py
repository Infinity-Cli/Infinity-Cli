"""Router agent for API backend"""

from typing import Dict, Any

from ..base import BaseAgent, AgentResult


class RouterAgent(BaseAgent):
    """Creates API routes and endpoints"""

    async def think(self) -> Dict[str, Any]:
        return {
            "analysis": "Creating FastAPI/Express router",
            "routes": ["/api", "/health", "/status"],
            "middleware": ["cors", "auth"],
        }

    async def execute(self) -> AgentResult:
        server_py = '''from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/api/status")
async def status():
    return {"agents": "running"}
'''
        await self._write_file("server.py", server_py)

        return AgentResult(
            success=True,
            output={"files": ["server.py"]},
            files_created=["server.py"],
        )

    async def test(self, result: AgentResult) -> AgentResult:
        server_path = self.workspace / "server.py"
        if server_path.exists() and "FastAPI" in server_path.read_text():
            return AgentResult(success=True)
        return AgentResult(success=False, error="Server not properly created")

    async def repair(self, result: AgentResult):
        await self.execute()