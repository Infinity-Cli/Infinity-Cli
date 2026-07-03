"""Status command - runtime status checker"""

from rich.console import Console
from ...cli.terminal import TerminalUI

console = Console()
ui = TerminalUI()


def status_command(
    watch: bool,
):
    """Show current runtime status and active agents."""
    ui.banner()

    console.print("[cyan]Runtime Status: Active[/cyan]")
    console.print("[dim]No active executions[/dim]")

    # Placeholder - will show real agent status
    ui.swarm_visualization({})