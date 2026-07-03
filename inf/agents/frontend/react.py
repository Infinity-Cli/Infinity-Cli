"""React frontend specialist agent"""

import json
from typing import Dict, Any

from ..base import BaseAgent, AgentResult


class ReactSpecialist(BaseAgent):
    """Creates React components with TypeScript and Tailwind CSS"""

    async def think(self) -> Dict[str, Any]:
        return {
            "analysis": "Creating React frontend application",
            "components": ["App.tsx", "index.css", "pages/", "components/"],
            "features": ["routing", "state", "api-client"],
        }

    async def execute(self) -> AgentResult:
        app_tsx = '''import { BrowserRouter as Router, Routes, Route } from "react-router-dom"

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<h1>Hello Infinity</h1>} />
      </Routes>
    </Router>
  )
}

export default App
'''
        await self._write_file("src/App.tsx", app_tsx)

        package_json = json.dumps({
            "name": "frontend",
            "dependencies": {
                "react": "^18.0.0",
                "react-dom": "^18.0.0",
                "react-router-dom": "^6.0.0",
            }
        }, indent=2)
        await self._write_file("package.json", package_json)

        return AgentResult(
            success=True,
            output={"files": ["src/App.tsx", "package.json"]},
            files_created=["src/App.tsx", "package.json"],
        )

    async def test(self, result: AgentResult) -> AgentResult:
        app_path = self.workspace / "src/App.tsx"
        if app_path.exists() and "Router" in app_path.read_text():
            return AgentResult(success=True)
        return AgentResult(success=False, error="React app not properly created")

    async def repair(self, result: AgentResult):
        await self.execute()