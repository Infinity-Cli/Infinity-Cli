"""Main entry point for Infinity CLI"""

import typer
from rich.console import Console
from rich.panel import Panel

from .cli.terminal import TerminalUI
from .cli.commands.ask import ask_command
from .cli.commands.run import run_command
from .cli.commands.status import status_command

console = Console()

app = typer.Typer(
    name="infinity",
    help="Infinity - Terminal-native autonomous AI operating system",
    rich_markup_mode="rich",
)


@app.command("ask")
def ask(
    prompt: str,
):
    """Conversational AI assistant mode."""
    ask_command(prompt)


@app.command("run")
def run(
    goal: str,
    confirm: bool = typer.Option(True, help="Ask for confirmation before starting"),
    max_agents: int = typer.Option(10, help="Maximum concurrent agents"),
    timeout: int = typer.Option(3600, help="Execution timeout in seconds"),
):
    """Autonomous swarm execution mode."""
    run_command(goal, confirm, max_agents, timeout)


@app.command("status")
def status(
    watch: bool = typer.Option(False, "--watch", "-w", help="Watch mode with live updates"),
):
    """Check runtime status."""
    status_command(watch)


@app.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
):
    if ctx.invoked_subcommand is None:
        console.print(Panel.fit(
            "[bold cyan]INFINITY CLI[/bold cyan]\n\n"
            "Terminal-native autonomous AI operating system\n\n"
            "Commands:\n"
            "  [green]infinity ask[/green] <prompt>   - Conversational AI assistant\n"
            "  [green]infinity run[/green] <goal>      - Autonomous swarm execution\n"
            "  [green]infinity status[/green]          - Runtime status\n",
            border_style="cyan",
        ))


if __name__ == "__main__":
    app()