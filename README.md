# Infinity-Cli

Infinity-Cli is a terminal-native autonomous AI operating system. It orchestrates
agent swarms through a lightweight DAG runtime, persists state in SQLite, and
integrates directly with cloud LLM providers.

## Quick start

See [ONBOARDING.md](./ONBOARDING.md) for one-command install, first-run setup,
and troubleshooting.

```bash
infinity                    # auto-start daemon + interactive mode
infinity --help             # all commands
infinity config             # configure your API key
infinity ask "hello"        # conversational mode (dry-run ready)
infinity run "goal"         # autonomous swarm execution (dry-run ready)
infinity status             # runtime status
```

## Installation

```bash
git clone <repo-url> /path/to/Infinity-Cli
cd /path/to/Infinity-Cli
python -m pip install -e .
```

## Development

```bash
python -m pip install -e ".[dev]"
pytest tests/ -v
```
