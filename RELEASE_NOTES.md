# v0.1.0 — Premium Onboarding Redesign

**Release date:** 2026-07-05

Infinity-Cli is a terminal-native autonomous AI operating system that orchestrates agent swarms through a lightweight DAG runtime, persists state in SQLite, and integrates directly with cloud LLM providers.

This release introduces the **TypeScript CLI (`cli-ts`)** — a modern, type-safe, test-driven replacement for the previous Python CLI — along with a branded onboarding flow, multi-agent roundtable (`infinity discuss`), NVIDIA API key auto-detection, and a comprehensive test suite.

## What's new

- **TypeScript CLI** (`cli-ts/`): Full rewrite in TypeScript with Zod validation, Commander-based subcommands, and Vitest test coverage (180+ tests).
- **Daemon with DAG runtime**: Autonomous agent orchestration via DAG, configurable via `infinity daemon start/stop/status`.
- **Premium onboarding redesign**: `infinity onboard` wizard — auto-detects provider, selects default model, validates connectivity, saves config.
- **Multi-agent roundtable**: `infinity discuss` — orchestrate multi-agent discussions with configurable rounds.
- **NVIDIA API key auto-detection**: Automatic detection of NVIDIA endpoints and default model selection.
- **Markdown-first CLI output**: Hidden agent chatter, `--format`/`--output`/`--verbose` flags for polished terminal output.
- **CI/CD**: GitHub Actions workflow for TypeScript (`ci-ts.yml`), linting with Biome, and test runners.
- **Config management**: `infinity config --reset`, `.env` auto-loading, provider detection.

## Installation

### Windows (PowerShell 5+)

```powershell
irm https://raw.githubusercontent.com/fluxion/infinity-cli/main/install.ps1 | iex
```

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/fluxion/infinity-cli/main/install.sh | sh
```

After installation, run `infinity` to auto-start the daemon and enter interactive mode.

## Changelog

See the full commit log:

```
9bc8231 release: v0.1.0 premium onboarding redesign + cli-ts
53f699d feat: markdown-first CLI output, hidden agent chatter, --format/--output/--verbose
c3b08f7 feat: add infinity discuss multi-agent roundtable command; fix .env loading
e1d323b fix: use available NVIDIA default model and provider default mapping
7fcf464 fix: load .env before settings, add config --reset, support nvidia detection
f3d5742 feat: add NVIDIA API key auto-detection and pytest config
669597b feat: complete autonomous swarm runtime, sync integration, tests, CI, and architecture docs
94560c3 Initial Infinity CLI implementation with agent swarm
fa0cbf5 Initial commit
```

Or visit: https://github.com/fluxion/infinity-cli/commits/v0.1.0

## License

MIT