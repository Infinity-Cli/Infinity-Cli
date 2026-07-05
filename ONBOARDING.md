# ONBOARDING

**Infinity-Cli** — a terminal-native autonomous AI operating system that orchestrates agent swarms through a lightweight DAG runtime, persists state in SQLite, and integrates directly with cloud LLM providers.

## One-command install

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/fluxion/infinity-cli/main/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/fluxion/infinity-cli/main/install.sh | sh
```

After installation, run `infinity` with no arguments to auto-start the daemon and enter interactive mode:

```bash
infinity
```

## First-run onboarding

1. Run the onboard wizard:
   ```bash
   infinity onboard
   ```
2. Paste your API key when prompted. The CLI auto-detects your provider, selects a sensible default model, validates connectivity, and saves the configuration.
3. You are ready to use `infinity` interactively.

## Platform notes

| Platform | Install command               | Shell           | Notes                                                                 |
|----------|-------------------------------|----------------|------------------------------------------------------------------------|
| Windows  | `install.ps1 \| iex`          | PowerShell 5+  | Run as non-admin; the script adds `~\.local\share\infinity-cli` to PATH |
| macOS     | `install.sh                   | bash / zsh     | Requires `curl` and `bash` (pre-installed)                            |
| Linux     | `install.sh`                   | bash / sh      | Requires `curl` (install via `apt`, `dnf`, or `pacman` if missing)   |

## Troubleshooting

### Daemon not running

```bash
infinity daemon status      # check if daemon is alive
infinity daemon start       # start it
infinity daemon stop        # stop it gracefully
```

### Port conflicts

The daemon binds to **port 14523** by default. If another process occupies it, set:

```bash
INFINITY_PORT=14524
```

or pass `--port` on the `daemon start` command.

### `infinity` command not found

Ensure the install script's wrapper directory is on your `PATH`:

- **Windows**: `$env:Path` should include `$env:USERPROFILE\.local\share\infinity-cli`
- **macOS / Linux**: `$HOME/.local/share/infinity-cli/bin` should be on `PATH`

Reopen your terminal or run:

```bash
source "$HOME/.bashrc"   # Linux / macOS
```