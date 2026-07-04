"""Rich terminal UI components for Infinity CLI"""

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn
from rich.table import Table
from rich.panel import Panel
from rich.tree import Tree
from rich.style import Style

from ..constants import AgentStatus

console = Console()


class TerminalUI:
    """Cinematic terminal UI for Infinity CLI"""

    def __init__(self):
        self.styles = {
            "planning": Style(color="cyan", bold=True),
            "executing": Style(color="green", bold=True),
            "repairing": Style(color="yellow", bold=True),
            "completed": Style(color="blue", bold=True),
            "failed": Style(color="red", bold=True),
            "error": Style(color="red"),
        }

    def banner(self):
        """Display Infinity CLI banner"""
        banner_text = """
[bold cyan][INFINITY] INFINITY CLI[/bold cyan]
[dim]Autonomous AI Operating System[/dim]
"""
        console.print(banner_text)

    def spinner(self, text: str):
        """Create a spinner for long operations"""
        return lambda: None  # dummy

    def live_spinner(self, text: str, get_content):
        """Display animated spinner with live content"""
        print(f"{text}...", end="", flush=True)
        try:
            # Just call the content function once for now
            get_content()
        finally:
            print(" done")

    def progress_bar(self, total: int, description: str = "Processing"):
        """Create a progress bar"""
        return Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            console=console,
        )

    def agent_status_tree(self, agents: dict) -> Tree:
        """Create a tree view of agent statuses"""
        tree = Tree("[bold cyan]Swarm Status[/bold cyan]")
        for agent_id, status in agents.items():
            style = self.styles.get(status.value, Style())
            icon = self._status_icon(status)
            tree.add(f"{icon} [{style}]{agent_id}[/{style}]: {status.value}")
        return tree

    def _status_icon(self, status: AgentStatus) -> str:
        icons = {
            AgentStatus.PLANNING: "[P]",
            AgentStatus.EXECUTING: "[E]",
            AgentStatus.REPAIRING: "[R]",
            AgentStatus.COMPLETED: "[C]",
            AgentStatus.FAILED: "[F]",
            AgentStatus.WAITING: "[W]",
        }
        return icons.get(status, "[?]")

    def log_panel(self, message: str, level: str = "info"):
        """Display a log message in a panel"""
        style = self.styles.get(level, Style())
        console.print(Panel(message, border_style=style.color, title=level.upper()))

    def swarm_visualization(self, agents: dict):
        """Display live swarm visualization"""
        table = Table(title="[cyan]Active Agents[/cyan]")
        table.add_column("Agent", style="cyan")
        table.add_column("Status", style="green")
        table.add_column("Task", style="yellow")
        table.add_column("Retries", style="red")

        for agent_id, data in agents.items():
            table.add_row(
                agent_id[:20],
                data.get("status", "?"),
                data.get("current_task", "?")[:30],
                str(data.get("retries", 0)),
            )

        console.print(table)