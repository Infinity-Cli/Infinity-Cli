"""Ask command - conversational AI assistant mode"""

from rich.console import Console

from ...cli.terminal import TerminalUI

console = Console()
ui = TerminalUI()


def ask_command(prompt: str):
    """One-shot conversational AI assistant.

    Just like talking to a helpful AI assistant for code explanations,
    brainstorming, or lightweight scripting tasks.
    """
    ui.banner()
    print("Processing...", end="", flush=True)
    # Simulate work
    print(" done")
    console.print(f"[bold green]Response:[/bold green] {prompt}")