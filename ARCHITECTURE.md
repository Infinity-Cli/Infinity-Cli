# InfinityCLI Architecture

## 1. Vision

InfinityCLI is a **terminal-native autonomous AI operating system**. A single command — `infinity run "<goal>"` — starts a self-managing swarm of specialized agents that think, plan, execute, test, repair, and retry until the goal is satisfied. The runtime is local-first, Ollama-backed, and optionally streams live state to a hosted FastAPI sync server (`Infinity-api`) and an Android companion app (`Infinity-apk`).

## 2. Core Design Principles

| Principle | How it is realized |
|---|---|
| **Local-first** | SQLite short-term memory, in-process ChromaDB vector memory fallback, local Ollama inference. |
| **Autonomous** | Every agent runs the `Think → Plan → Execute → Test → Observe → Repair → Retry` loop with caps, backoff, and jitter. |
| **Self-healing** | Runtime catches failures, compresses context, consults memory, and retries with a refined plan. |
| **Swarm-native** | Agents communicate over a typed message bus and execute as a dependency-aware DAG. |
| **Secure** | Shell commands pass a whitelist/blacklist sandbox validator; secrets are scanned before persistence. |
| **Observable** | Live status, logs, and commands stream through Infinity-api WebSockets to Android. |
| **Pluggable** | Model providers, memory backends, and tools are router-based and swappable. |

## 3. Runtime Execution Flow

```text
┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐
│   User      │───▶│  CLI / TUI  │───▶│  Orchestrator       │
│  `infinity  │    │  Typer +    │    │  DAG builder +      │
│  run goal`  │    │  Rich       │    │  scheduler          │
└─────────────┘    └─────────────┘    └─────────────────────┘
                                              │
                                              ▼
                              ┌───────────────────────────────┐
                              │  Agent runtime loop           │
                              │  Think → Plan → Execute →     │
                              │  Test → Observe → Repair →    │
                              │  Retry                        │
                              └───────────────────────────────┘
                                              │
            ┌─────────────────────────────────┼─────────────────────────────────┐
            ▼                                 ▼                                 ▼
   ┌─────────────────┐              ┌─────────────────┐              ┌─────────────────┐
   │  Model Router   │              │  Memory Layer   │              │  Sandbox        │
   │  Ollama / etc   │              │  SQLite +       │              │  Validator      │
   │                 │              │  ChromaDB       │              │                 │
   └─────────────────┘              └─────────────────┘              └─────────────────┘
            │                                 │                                 │
            ▼                                 ▼                                 ▼
   ┌─────────────────┐              ┌─────────────────┐              ┌─────────────────┐
   │  Agent Bus      │              │  Workspace      │              │  Secret Scanner │
   │  Pub/Sub        │              │  Isolated fs    │              │  .env guard     │
   └─────────────────┘              └─────────────────┘              └─────────────────┘
```

1. **Parse** — CLI parses the goal, optional flags (`--max-agents`, `--no-confirm`, `--sync-url`).
2. **Plan** — A planner agent decomposes the goal into a DAG of specialized tasks.
3. **Schedule** — The orchestrator assigns each node to a worker agent with an isolated workspace.
4. **Execute** — Each worker runs the autonomous loop, calling the model router and sandboxed tools.
5. **Persist** — State, logs, and memory are written to SQLite/ChromaDB.
6. **Stream** — If enabled, `SyncClient` pushes status/logs to Infinity-api and polls remote commands.
7. **Monitor** — The Android app and CLI `status` command display live progress.

## 4. Agent Communication

### 4.1 Typed Message Bus (`inf/agents/bus.py`)

- Channels: `orchestrator`, `agent.<id>`, `runtime`, `logs`, `errors`.
- Pattern: publish/subscribe + per-agent queues.
- Shared state: a namespaced key/value store with TTL.
- History: bounded per-channel message history for replay and debugging.

### 4.2 Agent Types

| Agent | Responsibility |
|---|---|
| `Planner` | Decomposes goals into tasks and dependencies. |
| `Architect` | Designs file structure and APIs. |
| `BackendEngineer` | Implements server/database logic. |
| `FrontendEngineer` | Implements UI components. |
| `QAEngineer` | Writes and runs tests, reports coverage. |
| `SecurityAuditor` | Scans secrets and validates sandbox commands. |
| `RepairAgent` | Diagnoses failures and proposes fixes. |
| `RuntimeObserver` | Streams status and handles remote commands. |

### 4.3 Inter-Agent Protocol

```json
{
  "type": "task_result|request_help|status_update|log_event",
  "from": "agent-id",
  "to": "agent-id|broadcast",
  "payload": {},
  "timestamp": "..."
}
```

## 5. Command Ecosystem

### 5.1 Primary Commands

```bash
infinity ask "question"            # Single-turn chat with the default model
infinity run "<goal>"              # Spawn a swarm to achieve a goal
infinity status                    # Live TUI dashboard of active runs
infinity list                      # List past runs and outcomes
infinity logs <run-id>             # Tail logs for a run
infinity replay <run-id>           # Replay execution timeline
infinity stop <run-id>             # Gracefully stop a running swarm
infinity resume <run-id>           # Resume a stopped or failed run
infinity memory search <query>     # Semantic search over vector memory
infinity memory history            # Browse short-term/long-term history
infinity config                    # Show/edit settings
infinity plugin list|install       # Manage plugins / MCP servers
infinity daemon start|stop|logs    # Control the background daemon
infinity sync register|pause|resume # Control Infinity-api streaming
```

### 5.2 Slash Commands (Interactive Shell)

Inside the Infinity shell (`infinity shell`):

| Slash command | Action |
|---|---|
| `/run <goal>` | Start a new swarm. |
| `/agents` | Show active agent tree. |
| `/pause` | Pause the current run. |
| `/resume` | Resume the current run. |
| `/retry <agent>` | Force retry an agent. |
| `/memory <query>` | Search memory. |
| `/status` | Show realtime dashboard. |
| `/logs` | Toggle live log panel. |
| `/quit` | Exit shell. |

### 5.3 Hidden / Power Commands

- `infinity --cinematic` — Full-screen animated dashboard.
- `infinity --headless` — Daemon mode with no TUI.
- `infinity debug dag <run-id>` — Render the execution DAG as ASCII/Graphviz.
- `infinity debug bus` — Inspect live message-bus traffic.
- `infinity repair <run-id>` — Spawn a repair swarm on a failed run.

## 6. Memory & Knowledge System

| Layer | Backend | Use Case |
|---|---|---|
| Short-term | SQLite | Recent conversation turns, working context. |
| Long-term | SQLite | Summaries, entity extraction, durable facts. |
| Vector | ChromaDB (in-process fallback) | Semantic retrieval, code embeddings. |
| History | SQLite + compression | Execution replay, timeline restoration. |

- Token compression (`ToonCompressor`) runs before long writes to stay within context windows.
- Memory is namespaced by `run_id` and `agent_id`.

## 7. Daemon & Runtime Architecture

```text
┌─────────────────────────────────────┐
│         infinity daemon             │
│  - Persistent runtime process       │
│  - WebSocket client to Infinity-api │
│  - Job queue and retry scheduler    │
│  - SQLite persistence               │
└─────────────────────────────────────┘
           │                │
           ▼                ▼
   ┌─────────────┐  ┌─────────────┐
   │ CLI client  │  │ Android app │
   │ (Typer/Rich)│  │ (Flutter)   │
   └─────────────┘  └─────────────┘
```

- The daemon can run headless; the CLI attaches to it for TUI sessions.
- Heartbeats detect online/offline state and queue commands for later delivery.

## 8. Infinity-api Sync Server

Hosted FastAPI service on Render with:

- **Firebase Auth** dependency (mock fallback for local tests).
- **Firestore** collections: `runtimes`, `runs`, `logs`, `commands` (in-memory fallback).
- **WebSocket** `/ws/{runtime_id}` for realtime streaming.
- **REST** endpoints for status, logs, commands.
- **Render** `render.yaml` for one-click deployment.

### 8.1 CLI Sync Client (`inf/sync/api_client.py`)

- `SyncClient` registers the runtime, pushes status/logs, polls pending commands, and opens a resilient WebSocket stream.
- HTTP retries use exponential backoff + jitter for 5xx and network errors.
- WebSocket reconnects automatically after disconnects.
- The client is non-blocking: the orchestrator schedules pushes/polls on the event loop.

## 9. Android Companion App (Infinity-apk)

Flutter app targeting Android API 34 with:

- Firebase Auth sign-in.
- Connection to Infinity-api REST/WebSocket.
- Dashboard: active agents, progress bars, logs, online/offline indicator.
- Remote controls: pause, resume, start new run.
- Offline queue: commands and status cached locally and synced when reconnecting.

## 10. Security & Sandboxing

- **Skylos Sandbox Validator**: command whitelist/blacklist, path-traversal checks, permission scopes.
- **Secret Scanner**: prevents keys/tokens from being written to `.env` or committed.
- **Isolated Workspaces**: each agent gets its own directory under `.infinity/runs/<run-id>/<agent-id>`.
- **Gitignore Guard**: rejects writes that would bypass `.gitignore`.

## 11. Plugin & MCP Ecosystem

- Plugins are Python packages exposing a `register(infinity)` entry point.
- MCP servers are configured in `~/.infinity/mcp.json`.
- Commands, agents, and tools can be added without modifying core code.

## 12. Testing & CI

### 12.1 Local test suite

- Run the full suite: `pytest tests/ -q`
- Key test modules:
  - `test_agents.py` — agent role dispatch and output parsing.
  - `test_bus.py` — typed message bus pub/sub and shared state.
  - `test_cli.py` — Typer CLI invocation and command routing.
  - `test_core.py` — planner, orchestrator, and runtime loop.
  - `test_full_pipeline.py` — end-to-end sync with Infinity-api (see below).
  - `test_memory.py` — SQLite short-term and vector memory.
  - `test_model_router.py` — Ollama client retries and model discovery.
  - `test_orchestrator_e2e.py` — DAG scheduling and failure recovery.
  - `test_sandbox.py` — command whitelist/blacklist validation.
  - `test_secrets.py` — secret scanner and `.env` guard.
  - `test_workspaces.py` — isolated per-agent filesystem workspaces.
- All model calls are mocked via `httpx` so Ollama does not need to be running.
- All sync API calls are mocked so Infinity-api does not need to be running.

### 12.2 GitHub Actions workflow (`.github/workflows/ci.yml`)

```yaml
# Triggers on every push and pull request.
# Matrix: ubuntu-latest, windows-latest.
# Steps: checkout → Python 3.11 → pip install -e ".[dev]" → pytest → ruff → mypy.
```

The CI job performs, in order:

1. **Install dependencies** — installs the package in editable mode with dev extras.
2. **Run tests** — `pytest tests/ -q` on both Ubuntu and Windows.
3. **Run ruff** — `ruff check .` for linting and style.
4. **Run mypy** — `mypy inf` for static type checking.

### 12.3 Full-pipeline sync test

`tests/test_full_pipeline.py` exercises the real CLI-to-API sync path without
external services. It monkey-patches `httpx.AsyncClient` so that:

- Ollama `/api/chat` and `/api/tags` return deterministic mock responses.
- Infinity-api `/status/{runtime_id}`, `/logs/`, `/commands/`, and
  `/commands/{command_id}` endpoints are served from in-memory dictionaries.

The test runs:

```bash
infinity run "build a simple api" \
  --no-confirm --max-agents 3 \
  --enable-sync --sync-base-url http://testserver
```

and asserts that:

- The CLI run completes with exit code 0 and prints "Run complete".
- At least one status document is pushed to `/status/{runtime_id}`.
- At least one log entry is pushed to `/logs/`.
- A pre-populated remote `pause` command is fetched, claimed, and patched.

This test is the primary guard against regressions in the CLI → Infinity-api
integration.

### 12.4 Related repositories

- **Infinity-api**: `pytest tests/` with Firebase/Firestore fallbacks.
- **Infinity-apk**: Flutter widget and integration tests via `flutter test`.

## 13. Deployment

### 13.1 Local installation

Infinity-Cli requires **Python 3.11+** (see `pyproject.toml`). To install from
source:

```bash
cd Infinity-Cli
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
```

`pyproject.toml` registers the `infinity` console script, so after installation
you can run:

```bash
infinity --help
```

### 13.2 Running a goal

The primary entry point is:

```bash
infinity run "build a simple api"
```

`inf/cli/main.py` exposes common flags such as `--max-agents`, `--no-confirm`,
`--timeout`, `--enable-sync`, and `--sync-base-url`. Without extra flags the run
is fully local and writes state to SQLite/ChromaDB under `.infinity/`.

### 13.3 Optional sync to Infinity-api

To stream status, logs, and commands to a remote Infinity-api instance, pass:

```bash
infinity run "build a simple api" \
  --enable-sync \
  --sync-base-url https://my-infinity-api.onrender.com
```

The `SyncClient` in `inf/sync/api_client.py`:

- Registers the runtime at `POST /status/{runtime_id}`.
- Pushes status updates and log entries over HTTP with exponential-backoff
  retries.
- Polls `GET /commands/?status=pending` for remote commands (pause, resume,
  start new run).
- Opens a resilient WebSocket to `/ws/{runtime_id}` to receive live broadcasts.

If an API key is configured it is sent as a `Bearer` token in the
`Authorization` header.

### 13.4 Render sync server pairing

The easiest hosted backend is Render using `Infinity-api/render.yaml`:

1. Push `Infinity-api` to GitHub.
2. In the Render dashboard choose **New + > Blueprint** and select
   `render.yaml`.
3. Set the environment variables in Render:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`
   - `FIREBASE_PRIVATE_KEY_ID`
   - `ALLOWED_ORIGINS`
   - `API_KEY`
4. Once the service is live, copy its URL and pair the CLI:

```bash
infinity run "<goal>" \
  --enable-sync \
  --sync-base-url https://<service-name>.onrender.com
```

Local development pairing against a locally running Infinity-api works the same
way with `--sync-base-url http://localhost:8000`.

## 14. Known Limitations

- **Ollama dependency / local-only inference default** — Real agent inference
  currently targets a local Ollama server. If Ollama is not reachable the
  runtime falls back to mocked/test behavior, which is useful for CI but does
  not produce meaningful results for real goals. A downloaded model such as
  `qwen2.5-coder:7b` is required.
- **Sandbox is not OS-level isolation** — The command validator in
  `inf/security/sandbox.py` is a whitelist/blacklist guard, not a container or
  VM. Malicious or accidentally destructive commands can still escape the
  workspace; run Infinity-Cli only in environments you trust.
- **WebSocket fan-out is limited to one Infinity-api instance** — The
  `ConnectionManager` keeps WebSocket connections in-process. If Infinity-api
  is scaled horizontally, broadcasts will not reach clients connected to other
  replicas unless a shared pub/sub layer (e.g. Redis) is added.
- **Flutter app requires manual Firebase setup** — Infinity-apk does not ship
  with a valid `google-services.json` or production Firebase options. The
  placeholders in `Infinity-apk/lib/main.dart` must be replaced with your own
  Firebase project values before the Android app can authenticate.
- **Free Render tier cold starts** — The Render Blueprint defaults to the free
  plan, which sleeps after inactivity. The first `--enable-sync` request or
  WebSocket connection after a sleep can take several seconds to wake up.
- **No built-in secret manager** — API keys and sync tokens are stored in local
  `.env` files or settings; there is no integration with a managed vault such as
  HashiCorp Vault or AWS Secrets Manager.
- **Infinity-api sync is opt-in** — Runs are local-first. Without
  `--enable-sync` / `--sync-base-url`, no data leaves the local machine and the
  Android dashboard cannot see the run.
- **Windows CI is slower** than Ubuntu because of environment setup and path
  handling differences.
- **Sandbox whitelist is conservative** — some legitimate shell idioms may be
  rejected until explicitly allowed.
- **Long-running tasks may exceed context windows** despite compression; very
  large repositories or logs can trigger truncation.
- **No built-in distributed execution** yet; all agents run in the same
  in-process runtime.

## 15. Future Evolution

- Adaptive runtime learning from past runs.
- Self-generated command packs based on repo analysis.
- Distributed swarm execution across multiple machines.
- Predictive planning using compressed memory embeddings.

## Deployment

- **Install from source.** Infinity-Cli requires Python 3.11+. Clone the repo, create a virtual environment, and install it in editable mode with dev dependencies:

  ```bash
  cd Infinity-Cli
  python -m venv .venv
  source .venv/bin/activate
  pip install -e .
  # or with dev tools:
  pip install -e ".[dev]"
  ```

  This registers the `infinity` console script.

- **Set up Ollama.** The default model provider expects a local Ollama server. Install Ollama, pull a model such as `qwen2.5-coder:7b`, and make sure it is running before executing real goals:

  ```bash
  ollama pull qwen2.5-coder:7b
  ollama serve
  ```

- **Run the interactive assistant.** For a single-turn chat with the configured model, use:

  ```bash
  infinity ask "how do I refactor this function?"
  ```

- **Run a swarm goal.** The primary command spawns an autonomous agent swarm to pursue a goal:

  ```bash
  infinity run "build a simple REST API"
  ```

  By default the run is local and persists state to SQLite/ChromaDB under `.infinity/`.

- **Optional sync to Infinity-api.** To stream status, logs, and remote commands to a hosted backend, pass `--enable-sync` and `--sync-base-url`:

  ```bash
  infinity run "build a simple REST API" \
    --enable-sync \
    --sync-base-url https://my-infinity-api.onrender.com
  ```

- **Deploy Infinity-api on Render.** The companion backend can be deployed from `Infinity-api/render.yaml` using Render's Blueprint flow: connect the Infinity-api repository, select the Blueprint, set the required Firebase and API environment variables, and then use the produced URL as `--sync-base-url`.

## Known Limitations

- **Ollama must be running locally for the default provider.** Real inference is performed against a local Ollama instance. If Ollama is unavailable, the runtime may fall back to mocked behavior that does not produce meaningful results for real goals.

- **Sandbox validator is pattern-based, not full OS isolation.** The security layer is a command whitelist/blacklist validator, not a container, VM, or kernel sandbox. Destructive or malicious commands can still escape the workspace, so Infinity-Cli should only be run in trusted environments.

- **Runs are local by default unless sync is enabled.** Without `--enable-sync` and `--sync-base-url`, no run state leaves the local machine and the Android/Web dashboards cannot observe the run.

- **Infinity-api WebSocket broadcasts are in-process.** The API's connection manager keeps WebSocket clients in memory. Scaling Infinity-api horizontally requires adding a shared pub/sub backend such as Redis; otherwise, broadcasts will not reach clients connected to other replicas.

- **Free Render tier cold starts.** The Render Blueprint defaults to the free plan, which sleeps after inactivity. The first sync request or WebSocket connection after a cold start can take several seconds.

- **Flutter Android app requires manual Firebase setup.** Infinity-apk does not ship with a production `google-services.json` or Firebase options. Developers must replace the placeholders with their own Firebase project configuration before building the Android app.

- **No built-in managed secret store.** API keys and sync tokens are stored in local `.env` files or settings; there is no integration with a managed vault such as HashiCorp Vault, AWS Secrets Manager, or Doppler.

- **Model output can be non-deterministic.** Local LLMs may produce different plans, code, or results across runs for the same goal, which can affect reproducibility in tests and real workflows.
