"""Base agent class with autonomous loop, sandboxing, compression, and coordination"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List
from pathlib import Path
import asyncio
import uuid
import json

from rich.console import Console

from ..utils.toon_compressor import ToonCompressor
from ..utils.skylos_sandbox import SkylosSandbox, SkylosSandboxError
from ..utils.multica_collaboration import MulticaCollaborationEngine, MulticaMessage

console = Console()


@dataclass
class AgentResult:
    """Result of agent execution"""
    success: bool
    output: Any = None
    error: Optional[str] = None
    files_created: List[str] = field(default_factory=list)


class BaseAgent(ABC):
    """Abstract base agent with autonomous execution loop

    Loop: Think → Plan → Execute → Test → Observe → Repair → Retry → Complete
    """

    def __init__(
        self,
        workspace: Path,
        task_id: Optional[str] = None,
        args: Optional[Dict[str, Any]] = None,
        collab_engine: Optional[MulticaCollaborationEngine] = None,
    ):
        self.id = str(uuid.uuid4())[:8]
        self.task_id = task_id or self.__class__.__name__.lower()
        self.workspace = Path(workspace)
        self.args = args or {}
        self.status = "waiting"
        self.retries = 0
        self.max_retries = 5
        self.pause_reason = ""
        self.tools = ["shell", "write", "read"]
        self._results: List[AgentResult] = []
        
        # Initialize Sandboxing and Multi-Agent Collaboration Engine
        self.sandbox = SkylosSandbox(allowed_workspace=self.workspace)
        self.collab_engine = collab_engine or MulticaCollaborationEngine()
        self.collab_engine.register_agent(self.id)

        self.workspace.mkdir(parents=True, exist_ok=True)

    @abstractmethod
    async def think(self) -> Dict[str, Any]:
        """Analyze task and create execution plan"""
        pass

    @abstractmethod
    async def execute(self) -> AgentResult:
        """Execute the task and return result"""
        pass

    @abstractmethod
    async def test(self, result: AgentResult) -> AgentResult:
        """Test the execution result"""
        pass

    async def run(self) -> Dict[str, Any]:
        """Main execution loop with self-healing"""
        # Compress prompt instruction if needed via Toon
        plan = await self.think()
        plan_compact = ToonCompressor.compress_prompt(json.dumps(plan))

        while self.retries < self.max_retries:
            # Check for any collaboration messages/handoffs
            messages = await self.collab_engine.fetch_messages(self.id)
            for msg in messages:
                console.print(f"[dim][Collaboration][/dim] Agent {self.id} received payload: {msg.message_type}")

            result = await self.execute()

            if result.success:
                tested = await self.test(result)
                if tested.success:
                    # Notify other agents of success/contracts
                    await self.collab_engine.send_message(MulticaMessage(
                        sender_id=self.id,
                        receiver_type="broadcast",
                        message_type="task_completed",
                        payload={"task_id": self.task_id, "output": result.output}
                    ))
                    return {"success": True, "result": result.output}

            self.retries += 1
            if self.retries < self.max_retries:
                self.status = "repairing"
                await self.repair(result)
                console.print(f"[yellow]Retry {self.retries}/{self.max_retries}[/yellow]")

        self.status = "failed"
        return {"success": False, "error": result.error if 'result' in dir() else "Max retries exceeded"}

    async def repair(self, result: AgentResult):
        """Attempt to repair failed execution"""
        pass

    async def _write_file(self, path: str, content: str):
        """Write file to agent workspace with Skylos Sandboxing path checks"""
        file_path = self.workspace / path
        # Validate path containment under the sandbox
        validated_path = self.sandbox.validate_path(file_path)
        
        validated_path.parent.mkdir(parents=True, exist_ok=True)
        validated_path.write_text(content)
        return str(validated_path)

    async def _shell(self, cmd: str) -> str:
        """Execute shell command with Skylos sandboxing security check"""
        is_safe, check_result = self.sandbox.execute_safely(cmd)
        if not is_safe:
            console.print(f"[bold red][Security Alarm][/bold red] Skylos sandboxing blocked command: {cmd}")
            return f"Blocked command: {check_result}"

        proc = await asyncio.create_subprocess_shell(
            check_result,
            cwd=str(self.workspace),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        raw_output = stdout.decode() + stderr.decode()
        
        # Optimize output tokens using Toon compressor for logs/traces
        return ToonCompressor.compress_traceback(raw_output)

    def get_contract_path(self) -> Path:
        """Get path to agent contract file"""
        return self.workspace / "contract.json"
