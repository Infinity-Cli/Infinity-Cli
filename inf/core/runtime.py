"""Async execution runtime with concurrency control"""

from dataclasses import dataclass
from typing import List, Callable, Optional
import asyncio
import time

from rich.console import Console

console = Console()


class AsyncRuntime:
    """Async execution engine with semaphore-based throttling and retry logic"""

    def __init__(self, max_concurrent: int = 10):
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.task_queue: asyncio.PriorityQueue = asyncio.PriorityQueue()
        self.active_tasks: set = set()

    async def execute_swarm(self, agents: List, dag: dict):
        """Execute all agents respecting DAG dependencies"""
        execution_order = dag.get("execution_order", [])
        if not execution_order:
            from .dag import DAG
            dag_obj = DAG(**dag)
            execution_order = dag_obj.topological_sort()

        completed = set()
        failed = set()

        for task_id in execution_order:
            if task_id in failed:
                continue

            agent = self._find_agent(agents, task_id)
            if not agent:
                continue

            success = await self._execute_with_retry(agent)
            if success:
                completed.add(task_id)
            else:
                failed.add(task_id)

    def _find_agent(self, agents: List, task_id: str):
        """Find agent by task ID"""
        for agent in agents:
            if hasattr(agent, 'task_id') and agent.task_id == task_id:
                return agent
            if hasattr(agent, 'id') and agent.id == task_id:
                return agent
        return None

    async def _execute_with_retry(self, agent) -> bool:
        """Execute agent with exponential backoff retry"""
        max_retries = 5
        base_delay = 1.0

        for attempt in range(max_retries):
            async with self.semaphore:
                try:
                    agent.status = "executing"
                    console.print(f"[green]Executing:[/green] {agent.__class__.__name__}")

                    result = await agent.run()

                    if result and result.get("success"):
                        agent.status = "completed"
                        return True
                    else:
                        agent.status = "repairing"
                        error = result.get("error", "Unknown error")
                        console.print(f"[yellow]Repair attempt {attempt + 1}:[/yellow] {error}")

                except Exception as e:
                    console.print(f"[red]Error:[/red] {e}")

            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                await asyncio.sleep(delay)

        agent.status = "failed"
        return False

    async def execute_task(self, task: Callable, priority: int = 0):
        """Queue a task for execution"""
        await self.task_queue.put((priority, task))

    async def worker(self, task_id: int):
        """Worker coroutine for processing task queue"""
        while True:
            priority, task = await self.task_queue.get()
            try:
                await task()
            finally:
                self.task_queue.task_done()