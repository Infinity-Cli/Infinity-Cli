"""Skylos security and sandboxing runtime engine.

Isolates command execution, checks system inputs, establishes permission boundaries,
controls workspace filesystem containment, and prevents dangerous runtime patterns.
"""

import re
import shlex
from pathlib import Path
from typing import Tuple


class SkylosSandboxError(Exception):
    """Exception raised for sandboxing or security boundary violations."""
    pass


class SkylosSandbox:
    """Skylos sandboxing protection layer for Infinity CLI micro-agents."""

    def __init__(self, allowed_workspace: Path):
        self.allowed_workspace = Path(allowed_workspace).resolve()
        # Banned commands/patterns
        self.banned_patterns = [
            r"\brm\s+-rf\s+/\b",  # root deletion
            r"\brmdir\s+.*",       # directory destruction outside boundary
            r"\b(wget|curl)\s+http(s)?://[^\s]+/.*(sh|bash|py|exe)\b", # untrusted downloads execution
            r"\bchmod\s+-R\s+777\b", # insecure permission grants
            r"\bdd\s+if=\b",      # raw drive write
            r"\bmkfs\b",          # partition formatting
            r"\bshred\b",         # secure file shredding
            r"\bformat\s+[A-Z]:\b", # Windows partition formatting
            r"\bdel\s+/s\s+/q\s+C:\\\b", # Windows recursive deletion of C drive
        ]
        # Restrict system path modifications
        self.blocked_executables = {
            "powershell.exe", "cmd.exe", "reg.exe", "schtasks.exe", "bash.exe"
        }

    def validate_path(self, path: Path) -> Path:
        """Verify that a path remains inside the scoped agent workspace directory."""
        resolved = Path(path).resolve()
        if not str(resolved).startswith(str(self.allowed_workspace)):
            raise SkylosSandboxError(
                f"Path traversal detected! Path '{resolved}' is outside the sandbox '{self.allowed_workspace}'"
            )
        return resolved

    def validate_command(self, cmd: str) -> str:
        """Analyze a shell command for dangerous operations and unauthorized execution."""
        cleaned_cmd = cmd.strip()
        
        # 1. Regexp check for banned patterns
        for pattern in self.banned_patterns:
            if re.search(pattern, cleaned_cmd, re.IGNORECASE):
                raise SkylosSandboxError(
                    f"Skylos Sandboxing: Action blocked! Dangerous pattern detected: {pattern}"
                )

        # 2. Tokenize command to check executables
        try:
            tokens = shlex.split(cleaned_cmd)
        except ValueError:
            # If shlex fails due to escaping, run re-based check on executable names
            tokens = cleaned_cmd.split()

        if tokens:
            executable = Path(tokens[0]).name.lower()
            if executable in self.blocked_executables:
                # We permit python/node/npm/pytest inside workspace, but block system shells/registry
                raise SkylosSandboxError(
                    f"Skylos Sandboxing: Action blocked! Blocked system executable: '{executable}'"
                )

        return cleaned_cmd

    def execute_safely(self, cmd: str) -> Tuple[bool, str]:
        """Wrap and sanitize commands before passing to subprocess runner."""
        try:
            validated_cmd = self.validate_command(cmd)
            return True, validated_cmd
        except SkylosSandboxError as e:
            return False, str(e)
