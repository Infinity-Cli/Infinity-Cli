"""Infinity CLI Typer application."""

import asyncio
import enum
from pathlib import Path
from typing import Optional
from uuid import uuid4

import typer
from rich.console import Console
from rich.panel import Panel

from inf.agents.registry import create_agent
from inf.config.keys import ApiKeyManager
from inf.core.config import load_settings
from inf.core.orchestrator import Orchestrator
from inf.models.router import ModelRouter
from inf.persistence.db import Database
from inf.providers.factory import get_provider, resolve_provider
from inf.runtime.helpers import run_single_agent_loop
from inf.server.server import start_server

from .discuss import PERSONAS, run_discussion

app = typer.Typer(
    name="infinity",
    help="Infinity - Terminal-native autonomous AI operating system",
    rich_markup_mode="rich",
)
console = Console()


def _provider_label(model: str) -> str:
    """Return the provider namespace from ``model`` if present."""
    if "/" in model:
        return model.split("/", 1)[0]
    return ""


class OutputFormat(str, enum.Enum):
    """Supported CLI output formats."""

    MARKDOWN = "markdown"
    RAW = "raw"


@app.command("ask")
def ask(
    prompt: str = typer.Argument(..., help="Question or instruction for the assistant"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print the call without invoking a provider"),
    model: Optional[str] = typer.Option(None, "--model", help="Model to use"),
    format: OutputFormat = typer.Option(OutputFormat.MARKDOWN, "--format", "-f", help="Output format"),
) -> None:
    """Conversational AI assistant mode. Prints the answer as Markdown by default."""
    settings = load_settings()
    resolved_model = model or settings.default_model
    provider_label = _provider_label(resolved_model) or settings.default_provider

    if dry_run:
        console.print(Panel.fit(
            f"[bold cyan]Dry-run ask[/bold cyan]\n\n"
            f"Prompt: {prompt}\n"
            f"Model: {resolved_model}\n"
            f"Provider: {provider_label}\n"
            f"Format: {format.value}\n\n"
            "No provider was called.",
            border_style="cyan",
        ))
        return

    if not settings.api_keys:
        console.print(Panel.fit(
            "[bold yellow]No API key configured[/bold yellow]\n\n"
            "Run [bold]infinity config[/bold] to add an API key.",
            border_style="yellow",
        ))
        raise typer.Exit(1)

    provider_id, api_key = resolve_provider(settings)
    if provider_label and provider_label in settings.api_keys:
        provider_id = provider_label
        api_key = settings.api_keys[provider_id]

    provider = get_provider(provider_id, api_key=api_key)
    messages = [{"role": "user", "content": prompt}]

    try:
        response = asyncio.run(provider.chat(messages, model=resolved_model))
    except Exception as exc:
        console.print(Panel.fit(
            f"[bold red]Provider error[/bold red]\n\n{exc}",
            border_style="red",
        ))
        raise typer.Exit(1)

    if format == OutputFormat.RAW:
        print(response)
    else:
        from rich.markdown import Markdown
        console.print(Markdown(response.strip()))


SWARM_STEPS = [
    ("Think", "Analyzing the goal and constraints..."),
    ("Plan", "Decomposing into actionable sub-tasks..."),
    ("Execute", "Running agents and generating artifacts..."),
    ("Test", "Verifying outputs against acceptance criteria..."),
    ("Repair", "Fixing issues and refining results..."),
]


@app.command("run")
def run(
    goal: str = typer.Argument(..., help="Goal for the autonomous swarm"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print execution plan without running agents"),
    confirm: bool = typer.Option(True, "--confirm/--no-confirm", help="Ask for confirmation before starting"),
    max_agents: int = typer.Option(10, "--max-agents", help="Maximum concurrent agents"),
    timeout: int = typer.Option(3600, "--timeout", help="Execution timeout in seconds"),
    enable_sync: bool = typer.Option(False, "--enable-sync", help="Push status/logs to Infinity-api and poll for commands"),
    sync_base_url: Optional[str] = typer.Option(None, "--sync-base-url", help="Infinity-api base URL (defaults to INFINITY_SYNC_BASE_URL or http://localhost:8000)"),
    output: OutputFormat = typer.Option(OutputFormat.MARKDOWN, "--output", "-o", help="Final report format"),
) -> None:
    """Autonomous swarm execution mode. Prints a Markdown report by default."""
    settings = load_settings()
    provider_id, api_key = resolve_provider(settings)

    if dry_run:
        plan = "\n".join(f"{i + 1}. {name}: {desc}" for i, (name, desc) in enumerate(SWARM_STEPS))
        console.print(Panel.fit(
            f"[bold green]Dry-run run[/bold green]\n\n"
            f"Goal: {goal}\n"
            f"Provider: {provider_id}\n"
            f"Confirm: {confirm}\n"
            f"Max agents: {max_agents}\n"
            f"Timeout: {timeout}s\n\n"
            f"Simulated plan:\n{plan}\n\n"
            "No agents were spawned.",
            border_style="green",
        ))
        return

    if confirm and not typer.confirm(f"Start autonomous run for goal: {goal}?"):
        console.print("Cancelled.")
        raise typer.Exit(0)

    db = Database()
    model_router = ModelRouter()
    try:
        # Only exercise Ollama refinement if the local server is reachable;
        # otherwise each agent would wait for a connection timeout.
        active_router: ModelRouter | None = model_router
        try:
            ollama_client = model_router.get_model("ollama")
            available = asyncio.run(
                asyncio.wait_for(ollama_client.validate(), timeout=2.0)
            )
            if not available:
                active_router = None
        except Exception:
            active_router = None

        orchestrator = Orchestrator()
        run_id = str(uuid4())
        workspace_root = Path(".infinity") / "runs" / run_id
        workspace_root.mkdir(parents=True, exist_ok=True)

        summary = asyncio.run(orchestrator.execute_goal(
            goal,
            db=db,
            model_router=active_router,
            workspace_root=workspace_root,
            max_agents=max_agents,
            timeout=timeout,
            run_id=run_id,
            jitter=False,
            enable_sync=enable_sync,
            sync_base_url=sync_base_url,
        ))
    finally:
        asyncio.run(db.close())

    report = _build_run_report(goal, provider_id, summary, output)
    if output == OutputFormat.RAW:
        print(report)
    else:
        from rich.markdown import Markdown
        console.print(Markdown(report.strip()))

    if not summary["success"]:
        raise typer.Exit(1)


def _build_run_report(goal: str, provider_id: str, summary: dict, output: OutputFormat) -> str:
    """Return a Markdown or plain-text summary of a swarm run."""
    status = "success" if summary["success"] else "failed"
    completed = summary.get("completed", [])
    failed = summary.get("failed", [])
    if output == OutputFormat.RAW:
        lines = [
            f"Status: {status}",
            f"Goal: {goal}",
            f"Provider: {provider_id}",
            f"Completed agents ({len(completed)}): {', '.join(completed) or 'none'}",
            f"Failed agents ({len(failed)}): {', '.join(failed) or 'none'}",
        ]
        return "\n".join(lines)
    lines = [
        f"# Swarm Run: {status.title()}",
        "",
        f"**Goal:** {goal}",
        f"**Provider:** {provider_id}",
        "",
        f"## Completed agents ({len(completed)})",
    ]
    if completed:
        lines.extend(f"- `{agent}`" for agent in completed)
    else:
        lines.append("_none_")
    lines.append("")
    lines.append(f"## Failed agents ({len(failed)})")
    if failed:
        lines.extend(f"- `{agent}`" for agent in failed)
    else:
        lines.append("_none_")
    return "\n".join(lines)


async def _tiny_sleep() -> None:
    await asyncio.sleep(0.05)


@app.command("status")
def status(
    watch: bool = typer.Option(False, "--watch", "-w", help="Watch mode with live updates"),
) -> None:
    """Check runtime status."""
    console.print(Panel.fit(
        "[bold blue]Infinity CLI runtime: not started[/bold blue]\n"
        f"Watch mode: {watch}",
        border_style="blue",
    ))


@app.command("loop")
def loop(
    goal: str = typer.Argument(..., help="Goal for the autonomous agent"),
    agent: str = typer.Option("planner", "--agent", "-a", help="Agent id to run"),
    workspace: Optional[str] = typer.Option("workspace", "--workspace", "-w", help="Agent workspace directory"),
    max_iterations: int = typer.Option(10, "--max-iterations", "-i", help="Maximum loop iterations"),
    max_retries: int = typer.Option(3, "--max-retries", "-r", help="Maximum retries after failure"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview the agent without running the loop"),
) -> None:
    """Run a single agent through the autonomous loop."""
    workspace_path = Path(workspace or "workspace").resolve()
    workspace_path.mkdir(parents=True, exist_ok=True)

    if dry_run:
        console.print(Panel.fit(
            f"[bold magenta]Dry-run loop[/bold magenta]\n\n"
            f"Agent: {agent}\n"
            f"Goal: {goal}\n"
            f"Workspace: {workspace_path}\n"
            f"Max iterations: {max_iterations}\n"
            f"Max retries: {max_retries}\n\n"
            "No agent was executed.",
            border_style="magenta",
        ))
        return

    selected_agent = create_agent(agent, workspace=workspace_path, task_id=goal)
    db = Database()
    try:
        result = asyncio.run(run_single_agent_loop(
            selected_agent,
            db=db,
            run_id=f"cli-loop-{agent}",
            task_id=goal,
            max_iterations=max_iterations,
            max_retries=max_retries,
            jitter=False,
        ))
    finally:
        asyncio.run(db.close())

    if result.success:
        report = (
            f"# Loop Complete\n\n"
            f"- **Agent:** {agent}\n"
            f"- **Iterations:** {result.iterations}\n"
            f"- **Retries:** {result.retries}\n"
        )
    else:
        report = (
            f"# Loop Failed\n\n"
            f"- **Agent:** {agent}\n"
            f"- **Error:** {result.error}\n"
            f"- **Iterations:** {result.iterations}\n"
            f"- **Retries:** {result.retries}\n"
        )
    from rich.markdown import Markdown
    console.print(Markdown(report.strip()))
    if not result.success:
        raise typer.Exit(1)


@app.command("discuss")
def discuss(
    topic: str = typer.Argument(..., help="Topic or question for the agents to discuss"),
    rounds: int = typer.Option(2, "--rounds", "-r", help="Number of discussion rounds"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print the setup without calling the provider"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show each agent turn"),
) -> None:
    """Multi-agent roundtable: agents discuss a topic and return Markdown.

    The internal conversation is hidden by default; use --verbose to see each
    agent turn. The final synthesized answer is printed as Markdown.
    """
    settings = load_settings()
    if dry_run:
        console.print(Panel.fit(
            f"[bold cyan]Dry-run discuss[/bold cyan]\n\n"
            f"Topic: {topic}\n"
            f"Rounds: {rounds}\n"
            f"Agents: {', '.join(p.id for p in PERSONAS)}\n\n"
            "No provider was called.",
            border_style="cyan",
        ))
        return

    if not settings.api_keys:
        console.print(Panel.fit(
            "[bold yellow]No API key configured[/bold yellow]\n\n"
            "Run [bold]infinity config[/bold] to add an API key.",
            border_style="yellow",
        ))
        raise typer.Exit(1)

    provider_id, api_key = resolve_provider(settings)
    provider = get_provider(provider_id, api_key=api_key)

    try:
        answer = asyncio.run(run_discussion(topic, provider, settings, rounds=rounds, console=console, verbose=verbose))
    except Exception as exc:
        console.print(Panel.fit(
            f"[bold red]Discussion failed[/bold red]\n\n{exc}",
            border_style="red",
        ))
        raise typer.Exit(1)

    from rich.markdown import Markdown
    console.print(Markdown(answer.strip()))


@app.command("config")
def config(
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview configuration steps without writing"),
    reset: bool = typer.Option(False, "--reset", help="Clear existing API keys and re-prompt"),
) -> None:
    """Configure API keys and runtime settings.

    Interactively prompts for an API key, detects the provider from the key
    prefix, stores it in ``.env``, and runs a lightweight validation call.
    """
    if dry_run:
        console.print(Panel.fit(
            "[bold magenta]Dry-run config[/bold magenta]\n\n"
            "Would prompt for an API key, detect the provider, write to .env, and validate with a test call.",
            border_style="magenta",
        ))
        return
    manager = ApiKeyManager()
    if reset:
        manager.clear_keys()
        console.print("[yellow]Existing API keys cleared.[/yellow]")
    if manager.has_any_key():
        console.print("[green]At least one API key is already configured.[/green]")
        return
    manager.prompt_and_store()


@app.command("server")
def server(
    host: str = typer.Option("127.0.0.1", "--host", help="Host address to bind to"),
    port: int = typer.Option(8000, "--port", help="Port number to listen on"),
) -> None:
    """Start the Infinity CLI local server."""
    console.print(f"[bold blue]Starting Infinity server on {host}:{port}[/bold blue]")
    start_server(host=host, port=port)


def main() -> None:
    """Entry point used by the console script."""
    app()


if __name__ == "__main__":
    main()
