"""Run command - autonomous Infinity mode"""

import asyncio

import typer
from rich.console import Console
from rich.prompt import Confirm

from ...cli.terminal import TerminalUI
from ...core.orchestrator import Orchestrator

console = Console()
ui = TerminalUI()


def run_command(
    goal: str,
    confirm: bool,
    max_agents: int,
    timeout: int,
):
    """Autonomous swarm execution.

    Infinity will analyze your goal, spawn a team of specialized AI agents,
    and build software autonomously with self-healing loops.
    """
    ui.banner()

    console.print(f"[bold green]Goal:[/bold green] {goal}")
    console.print(f"[dim]Max agents:[/dim] {max_agents}")
    console.print(f"[dim]Timeout:[/dim] {timeout}s")

    if confirm:
        if not Confirm.ask("Proceed with autonomous execution?"):
            console.print("[yellow]Cancelled.[/yellow]")
            raise typer.Exit()

    orchestrator = Orchestrator()
    order = asyncio.run(orchestrator.execute(goal))
    console.print(f"[dim]Planned execution order:[/dim] {order}")