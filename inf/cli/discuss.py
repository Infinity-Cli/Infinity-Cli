"""Multi-agent roundtable discussion command."""

from dataclasses import dataclass

from rich.console import Console
from rich.markdown import Markdown

from inf.agents.bus import MessageBus
from inf.core.config import Settings
from inf.providers.base import Provider


@dataclass
class Persona:
    """A discussion participant."""

    id: str
    name: str
    system_prompt: str


PERSONAS: list[Persona] = [
    Persona(
        id="planner",
        name="Planner",
        system_prompt=(
            "You are a planning agent. Break the user's topic into clear steps "
            "and trade-offs. Keep your response concise (2-4 sentences)."
        ),
    ),
    Persona(
        id="coder",
        name="Coder",
        system_prompt=(
            "You are a hands-on coding agent. Provide concrete code, patterns, "
            "or implementation details. Keep your response concise."
        ),
    ),
    Persona(
        id="reviewer",
        name="Reviewer",
        system_prompt=(
            "You are a QA/reviewer agent. Point out risks, edge cases, and "
            "improvements. Keep your response concise."
        ),
    ),
]

MODERATOR_SYSTEM = (
    "You are a moderator. Synthesize the agents' discussion into a final, "
    "self-contained answer in Markdown format. Include code examples only if "
    "they help the answer. Do not mention the agents unless necessary."
)


class RoundTable:
    """Run a hidden multi-agent discussion and return a Markdown result."""

    def __init__(
        self,
        topic: str,
        provider: Provider,
        settings: Settings,
        personas: list[Persona] | None = None,
        rounds: int = 2,
        console: Console | None = None,
        verbose: bool = False,
    ) -> None:
        self.topic = topic
        self.provider = provider
        self.settings = settings
        self.personas = personas or PERSONAS
        self.rounds = max(1, rounds)
        self.bus = MessageBus()
        self.console = console or Console()
        self.verbose = verbose

    async def run(self) -> str:
        """Execute the roundtable and return a Markdown string."""
        history: list[dict[str, str]] = []

        for round_num in range(1, self.rounds + 1):
            for persona in self.personas:
                messages = self._build_messages(persona, history)
                response = await self.provider.chat(messages)
                await self.bus.publish("discussion", persona.id, response)
                history.append({"role": "assistant", "content": f"{persona.name}: {response}"})
                if self.verbose:
                    self.console.print(
                        f"[dim][round {round_num}] {persona.name} spoke[/dim]",
                        highlight=False,
                    )

        final_messages = [
            {"role": "system", "content": MODERATOR_SYSTEM},
            {"role": "user", "content": f"Topic: {self.topic}\n\nDiscussion:\n"},
        ]
        for msg in history:
            final_messages.append(msg)
        final_messages.append(
            {"role": "user", "content": "Please produce the final Markdown answer."}
        )
        return await self.provider.chat(final_messages)

    def _build_messages(
        self,
        persona: Persona,
        history: list[dict[str, str]],
    ) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = [
            {"role": "system", "content": persona.system_prompt},
            {"role": "user", "content": f"Topic: {self.topic}"},
        ]
        messages.extend(history)
        messages.append({"role": "user", "content": f"{persona.name}, share your perspective."})
        return messages


def render_markdown(text: str, console: Console | None = None) -> None:
    """Print Markdown output without a surrounding panel."""
    (console or Console()).print(Markdown(text.strip()))


async def run_discussion(
    topic: str,
    provider: Provider,
    settings: Settings,
    rounds: int = 2,
    console: Console | None = None,
    verbose: bool = False,
) -> str:
    """Convenience entry point for the roundtable."""
    table = RoundTable(
        topic=topic,
        provider=provider,
        settings=settings,
        rounds=rounds,
        console=console,
        verbose=verbose,
    )
    return await table.run()
