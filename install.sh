#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Infinity-CLI — cross-platform installer for Linux and macOS
# ---------------------------------------------------------------------------
# One-line installer that bootstraps uv, installs a managed Python,
# creates a virtual environment, installs Infinity-CLI in editable
# mode, and updates the user PATH.
#
# Usage:
#   bash install.sh                    # full install
#   bash install.sh --dry-run          # preview only
#   bash install.sh --python-version 3.12  # specify Python version
#
# Environment:
#   INFINITY_CLI_HOME — optional override for install root
# ---------------------------------------------------------------------------
set -euo pipefail

# ---- CLI args ------------------------------------------------------------
DRY_RUN=false
PYTHON_VERSION="3.12"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=true; shift ;;
        --python-version)
            if [[ $# -lt 2 ]]; then
                echo "ERROR: --python-version requires a value (e.g. --python-version 3.12)"
                exit 1
            fi
            PYTHON_VERSION="$2"
            shift 2
            ;;
        --python-version=*)
            PYTHON_VERSION="${1#*=}"
            shift
            ;;
        *) echo "WARNING: unknown argument '$1', ignoring"; shift ;;
    esac
done

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
RELEASE_VERSION="v0.1.17"
SOURCE_ARCHIVE_URL="https://github.com/Infinity-Cli/Infinity-Cli/archive/refs/tags/${RELEASE_VERSION}.tar.gz"

resolve_project_root() {
	local script_path="${BASH_SOURCE[0]:-}"
	if [[ -n "$script_path" && -f "$script_path" && -r "$script_path" ]]; then
		local local_root
		local_root="$(cd "$(dirname "$script_path")" && pwd)"
		if [[ -f "$local_root/pyproject.toml" ]]; then
			echo "$local_root"
			return
		fi
	fi

	local download_dir="${TMPDIR:-/tmp}/infinity-cli-$RELEASE_VERSION"
	local archive_path="$download_dir.tar.gz"

	if [[ -d "$download_dir" && -f "$download_dir/pyproject.toml" ]]; then
		echo "$download_dir"
		return
	fi

	echo "Downloading Infinity-CLI $RELEASE_VERSION source archive" >&2
	if [[ "$DRY_RUN" == true ]]; then
		echo "    [DRY-RUN] Would download source archive from: $SOURCE_ARCHIVE_URL" >&2
		echo "    [DRY-RUN] Would extract to: $download_dir" >&2
		echo "$download_dir"
		return
	fi

	mkdir -p "$download_dir"
	curl -fsSL "$SOURCE_ARCHIVE_URL" -o "$archive_path"
	tar -xzf "$archive_path" -C "$download_dir" --strip-components=1
	rm -f "$archive_path"
	if [[ ! -f "$download_dir/pyproject.toml" ]]; then
		echo "ERROR: Source archive did not extract to expected directory: $download_dir" >&2
		exit 1
	fi
	echo "$download_dir"
}

PROJECT_ROOT="$(resolve_project_root)"

# ---------------------------------------------------------------------------
# OS detection
# ---------------------------------------------------------------------------
detect_os() {
    local os arch
    case "$(uname -s)" in
        Linux*)  os="linux" ;;
        Darwin*) os="macos" ;;
        *)       os="unknown" ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x86_64" ;;
        aarch64|arm64) arch="aarch64" ;;
        *) arch="$(uname -m)" ;;
    esac

    echo "$os $arch"
}

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
read -r OS ARCH <<< "$(detect_os)"

INSTALL_ROOT="${INFINITY_CLI_HOME:-}"
if [[ -z "$INSTALL_ROOT" ]]; then
    INSTALL_ROOT="$HOME/.local/share/infinity-cli"
fi

BIN_DIR="$HOME/.local/bin"
VENV_DIR="$INSTALL_ROOT/venv"

# ---------------------------------------------------------------------------
# Progress / logging helpers
# ---------------------------------------------------------------------------
_timestamp() { date '+%H:%M:%S'; }

log() {
    local msg="$1"
    echo "[$(_timestamp)] $msg" >&2
}

log_info()  { log "INFO:  $1"; }
log_warn()  { log "WARN:  $1"; }
log_ok()    { log "OK:    $1"; }
log_error() { log "ERROR: $1"; }

dry_run_note() {
    if $DRY_RUN; then
        echo "  [DRY-RUN] $1" >&2
    fi
}

# ---------------------------------------------------------------------------
# step wrapper
# ---------------------------------------------------------------------------
step() {
    local label="$1"
    shift
    log_info "Starting: $label"
    if $DRY_RUN; then
        dry_run_note "Would execute: $*"
        return 0
    fi
    "$@"
    log_ok "Completed: $label"
}

# ---------------------------------------------------------------------------
# Main install function
# ---------------------------------------------------------------------------
bootstrap_uv() {
    log_info "Bootstrapping uv"

    if $DRY_RUN; then
        dry_run_note "Would download uv installer from: https://github.com/astral-sh/uv/releases/latest/download/uv-installer.sh"
        dry_run_note "Would run installer targeting install root: $INSTALL_ROOT"
        return 0
    fi

    if command -v uv &>/dev/null; then
        log_info "uv already found on PATH"
        return 0
    fi

    local installer_url="https://github.com/astral-sh/uv/releases/latest/download/uv-installer.sh"
    local tmpdir
    tmpdir="$(mktemp -d)"

    # Use curl or wget
    if command -v curl &>/dev/null; then
        curl -fsSL "$installer_url" -o "$tmpdir/uv-installer.sh"
    elif command -v wget &>/dev/null; then
        wget -q "$installer_url" -O "$tmpdir/uv-installer.sh"
    else
        log_error "neither curl nor wget found. Please install one of them."
        exit 1
    fi

    # Make executable and run
    chmod +x "$tmpdir/uv-installer.sh"
    UV_INSTALL_DIR="$INSTALL_ROOT" bash "$tmpdir/uv-installer.sh"
    rm -rf "$tmpdir"

    log_ok "uv installed"
}

install_python() {
    log_info "Installing managed Python $PYTHON_VERSION via uv"

    if $DRY_RUN; then
        dry_run_note "Would run: uv python install $PYTHON_VERSION"
        return 0
    fi

    # Ensure uv is on PATH
    export PATH="$INSTALL_ROOT/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

    if ! command -v uv &>/dev/null; then
        if [[ -x "$INSTALL_ROOT/bin/uv" ]]; then
            export PATH="$INSTALL_ROOT/bin:$PATH"
        else
            log_error "uv not found. Install uv first."
            exit 1
        fi
    fi

    uv python install "$PYTHON_VERSION"
    log_ok "Python $PYTHON_VERSION installed"
}

install_infinity_cli() {
    log_info "Creating virtual environment and installing Infinity-CLI"

    local uv_exe
    uv_exe="$(command -v uv || echo "$INSTALL_ROOT/bin/uv")"

    if $DRY_RUN; then
        dry_run_note "Would create venv at: $VENV_DIR"
        dry_run_note "Would run: $uv_exe venv '$VENV_DIR' --python $PYTHON_VERSION"
        dry_run_note "Would install: $uv_exe pip install -e '$PROJECT_ROOT'"
        return 0
    fi

    # Create install root and bin dir
    mkdir -p "$INSTALL_ROOT"
    mkdir -p "$BIN_DIR"
    mkdir -p "$(dirname "$VENV_DIR")"

    # Create venv
    log_info "Creating virtual environment at $VENV_DIR"
    "$uv_exe" venv "$VENV_DIR" --python "$PYTHON_VERSION"

    # Activate venv
    local venv_bin="$VENV_DIR/bin"
    if [[ ! -f "$venv_bin/python" && ! -f "$venv_bin/python3" ]]; then
        log_error "venv python not found at $venv_bin"
        exit 1
    fi

    # Install package in editable mode — use the venv's python
    local venv_python="$venv_bin/python"
    if [[ ! -x "$venv_python" ]]; then
        venv_python="$venv_bin/python3"
    fi
    log_info "Installing Infinity-CLI in editable mode"
    "$uv_exe" pip install -e "$PROJECT_ROOT" --python "$venv_python"

    log_ok "Infinity-CLI Python backend installed"
}

build_typescript_cli() {
    log_info "Building TypeScript CLI front-end"

    if ! command -v node &>/dev/null; then
        log_error "Node.js is required to build the Infinity CLI front-end but was not found on PATH."
        exit 1
    fi

    local cli_dir="$PROJECT_ROOT/cli-ts"

    if $DRY_RUN; then
        dry_run_note "Would install Node dependencies (including TUI dependencies: ink, react, @inkjs/ui) in $cli_dir"
        dry_run_note "Would run: npm install in $cli_dir"
        dry_run_note "Would run: npm run build in $cli_dir to build the TUI entry point"
        return 0
    fi

    if [[ ! -d "$cli_dir" ]]; then
        log_error "TypeScript CLI source not found at $cli_dir"
        exit 1
    fi

    log_info "Installing Node dependencies for TypeScript CLI"
    (cd "$cli_dir" && npm install)
    if [[ $? -ne 0 ]]; then
        log_error "npm install failed in $cli_dir"
        exit 1
    fi

    log_info "Building TypeScript CLI"
    (cd "$cli_dir" && npm run build)
    if [[ $? -ne 0 ]]; then
        log_error "npm run build failed in $cli_dir"
        exit 1
    fi

    local dist_path="$cli_dir/dist/index.js"
    if [[ ! -f "$dist_path" ]]; then
        log_error "TypeScript CLI build did not produce $dist_path"
        exit 1
    fi

    log_ok "TypeScript CLI built"
}

install_wrappers() {
    log_info "Creating Infinity CLI wrapper script"

    local node_path
    node_path="$(command -v node)"
    local dist_path="$PROJECT_ROOT/cli-ts/dist/index.js"

    if $DRY_RUN; then
        dry_run_note "Would create wrapper script at: $BIN_DIR/infinity"
        dry_run_note "  node: $node_path"
        dry_run_note "  dist: $dist_path (includes the infinity tui entry point)"
        return 0
    fi

    mkdir -p "$BIN_DIR"
    local infinity_path="$BIN_DIR/infinity"
    cat > "$infinity_path" << WRAPPER_EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$node_path" "$dist_path" "$@"
WRAPPER_EOF
    chmod +x "$infinity_path"

    log_ok "Infinity CLI wrapper created"
}

remove_old_infinity_wrapper() {
    local old_path="$HOME/.local/bin/infinity"
    if [[ -f "$old_path" ]]; then
        if $DRY_RUN; then
            dry_run_note "Would remove old infinity wrapper: $old_path"
        else
            log_info "Removing old infinity wrapper: $old_path"
            rm -f "$old_path"
        fi
    fi
}

update_path() {
    log_info "Updating PATH"

    local profile_file
    local shell_name="${SHELL##*/}"

    case "$shell_name" in
        bash) profile_file="$HOME/.bash_profile" ;;
        zsh)  profile_file="$HOME/.zshrc" ;;
        *)    profile_file="$HOME/.profile" ;;
    esac

    # Also check for .profile fallback
    if [[ ! -f "$profile_file" ]]; then
        profile_file="$HOME/.profile"
    fi

    # Prepend the new bin dir so it wins over any stale global installation.
    local path_line="export PATH=\"$BIN_DIR:\$PATH\""

    if $DRY_RUN; then
        dry_run_note "Would add to $profile_file:"
        echo "    $path_line" >&2
        return 0
    fi

    # Check if already present
    if grep -qF "$BIN_DIR" "$profile_file" 2>/dev/null; then
        log_info "PATH entry already present in $profile_file"
        return 0
    fi

    echo "" >> "$profile_file"
    echo "# Added by Infinity-CLI installer" >> "$profile_file"
    echo "$path_line" >> "$profile_file"
    log_ok "Prepended $BIN_DIR to PATH in $profile_file"
}

check_node() {
    log_info "Checking Node.js availability"

    if $DRY_RUN; then
        dry_run_note "Would check for node >= 18"
    fi

    if command -v node &>/dev/null; then
        local version
        version="$(node --version 2>/dev/null || true)"
        if [[ -n "$version" ]]; then
            local major
            major="$(echo "$version" | sed 's/v//' | cut -d. -f1)"
            if [[ "$major" -ge 18 ]]; then
                log_ok "Node.js $version available"
            else
                log_warn "Node.js $version found, but >= 18 required"
            fi
        else
            log_warn "Could not determine Node.js version"
        fi
    else
        log_warn "Node.js not found on PATH. Infinity-CLI requires Node.js >= 18."
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    echo "==========================================" >&2
    echo "  Infinity-CLI Installer" >&2
    echo "==========================================" >&2
    if $DRY_RUN; then
        echo "  DRY-RUN MODE — no changes will be made" >&2
    fi
    echo "" >&2

    log_info "Detected OS: $OS, Architecture: $ARCH"
    log_info "Install root: $INSTALL_ROOT"
    log_info "Bin dir: $BIN_DIR"
    log_info "Python version: $PYTHON_VERSION"
    echo "" >&2

    # Bail on unknown OS — the installer is designed for Linux/macOS
    if [[ "$OS" == "unknown" ]]; then
        log_error "Unsupported OS: $(uname -s)"
        exit 1
    fi

    # Step 1: bootstrap uv
    bootstrap_uv

    # Step 2: install managed Python
    install_python

    # Step 3: install Infinity-CLI Python backend
    install_infinity_cli

    # Step 4: build TypeScript CLI front-end
    build_typescript_cli

    # Step 5: create wrapper scripts
    install_wrappers

    # Step 6: remove stale wrappers and update PATH
    remove_old_infinity_wrapper
    update_path

    # Step 7: Node.js check
    check_node

    echo "" >&2
    if $DRY_RUN; then
        log_ok "Dry run completed. No changes were made."
    else
        log_ok "Installation complete."
        echo ""
        echo "  You may need to open a new terminal or run:" >&2
        echo "    source ~/.bash_profile" >&2
        echo "  (or equivalent for your shell) for PATH changes to take effect." >&2
        echo "" >&2
        echo "  Run 'infinity' to get started." >&2
    fi

    exit 0
}

main "$@"