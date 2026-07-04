"""Skylos-inspired sandbox validator for agent shell commands.

Provides command whitelist/blacklist enforcement, path traversal checks,
and permission scopes to constrain what an autonomous agent is allowed to
execute on the local machine.
"""

from __future__ import annotations

import os
import re
import shlex
from pathlib import Path
from typing import Iterable


class SandboxValidationError(Exception):
    """Raised when a command fails sandbox validation."""

    pass


class SandboxValidator:
    """Validate shell commands against a configurable sandbox policy.

    The validator supports four permission scopes:

    - ``execute`` (default): full whitelisted command set.
    - ``read``: only read-oriented commands (``cat``, ``ls``, ``echo``).
    - ``write``: filesystem mutating commands confined to allowed paths.
    - ``network``: outbound network access via ``curl`` to allowed URLs.

    Runtime mutation is supported via :meth:`allow` and :meth:`deny`.
    """

    # Base commands allowed in the default ``execute`` scope.
    DEFAULT_COMMANDS: set[str] = {
        "python",
        "pytest",
        "git",
        "ls",
        "cat",
        "echo",
        "cp",
        "mv",
        "rm",
        "mkdir",
        "curl",
    }

    # Commands allowed for each permission scope.
    SCOPE_COMMANDS: dict[str, set[str]] = {
        "execute": set(DEFAULT_COMMANDS),
        "read": {"cat", "ls", "echo"},
        "write": {"cp", "mv", "rm", "mkdir", "cat", "ls", "echo"},
        "network": {"curl", "cat", "ls", "echo"},
    }

    # Dangerous command patterns that are always rejected.
    DANGEROUS_PATTERNS: list[str] = [
        r"\brm\s+-rf\s+/",  # rm -rf / or /anything
        r"\bmkfs\b",
        r"\bdd\s+if=\s*/dev/",
        r"\bdd\s+if=.*of=/dev/[sh]da\b",
        r"\bshutdown\b",
        r"\breboot\b",
        r"\binit\s+0\b",
        r":\s*\(\)\s*\{\s*.*:\s*\|\s*:\s*&\s*\}\s*;\s*:",  # fork bomb
        r"\bchmod\s+-R\s+777\b",
        r"\bwget\b",
        r"\bpowershell\.exe\b",
        r"\bcmd\.exe\b",
        r"\bschtasks\.exe\b",
        r"\breg\.exe\b",
        r"\bformat\s+[A-Za-z]:\\?\b",
        r"\bdel\s+/[sfq]+\b",
    ]

    # Shell metacharacters that break out of a single command.
    METACHAR_PATTERNS: list[str] = [
        r";",
        r"&&",
        r"\|\|",
        r"\|",
        r"`",
        r"\$\(",
    ]

    def __init__(
        self,
        default_workspace: Path | str | None = None,
        allowed_urls: Iterable[str] | None = None,
    ):
        """Create a new sandbox validator.

        Args:
            default_workspace: Directory used as the default containment root
                when ``validate`` is called without ``allowed_paths``.
            allowed_urls: URLs that ``curl`` is permitted to contact in the
                ``network`` scope. If empty, all http(s) URLs are allowed.
        """
        self.default_workspace = Path(default_workspace or Path("workspace")).resolve()
        self.allowed_urls = [url.rstrip("/") for url in (allowed_urls or [])]
        self._scope_commands = {
            scope: set(cmds) for scope, cmds in self.SCOPE_COMMANDS.items()
        }
        self._dangerous_regex = [
            re.compile(p, re.IGNORECASE) for p in self.DANGEROUS_PATTERNS
        ]
        self._metachar_regex = [re.compile(p) for p in self.METACHAR_PATTERNS]

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def allow(self, command_name: str) -> None:
        """Allow ``command_name`` in all scopes at runtime."""
        name = command_name.strip().lower()
        for scope in self._scope_commands:
            self._scope_commands[scope].add(name)

    def deny(self, command_name: str) -> None:
        """Deny ``command_name`` in all scopes at runtime."""
        name = command_name.strip().lower()
        for scope in self._scope_commands:
            self._scope_commands[scope].discard(name)

    def validate(
        self,
        command: str | list[str],
        allowed_paths: list[Path] | None = None,
        scope: str = "execute",
    ) -> dict:
        """Validate a command against the sandbox policy.

        Args:
            command: Shell command as a string or pre-tokenized list.
            allowed_paths: Containment roots for path arguments. Defaults to
                ``[default_workspace]``.
            scope: Permission scope (``execute``, ``read``, ``write``,
                ``network``).

        Returns:
            A dictionary with ``ok`` (bool), ``reason`` (str | None), and
            ``command`` (sanitized command string).
        """
        if scope not in self._scope_commands:
            return self._result(False, f"Unknown permission scope: {scope!r}", command)

        roots = self._normalize_roots(allowed_paths)

        # 1. Normalize tokens and raw command string.
        if isinstance(command, str):
            raw = command.strip()
            if not raw:
                return self._result(False, "Empty command", command)
            try:
                tokens = shlex.split(raw, posix=os.name != "nt")
            except ValueError as exc:
                return self._result(False, f"Unable to parse command: {exc}", command)
            sanitized = raw
        else:
            if not command:
                return self._result(False, "Empty command", command)
            tokens = [str(t) for t in command]
            sanitized = " ".join(shlex.quote(t) for t in tokens)
            raw = sanitized

        # 2. Dangerous patterns (regex) are always blocked first.
        danger_reason = self._check_dangerous_patterns(raw)
        if danger_reason:
            return self._result(False, danger_reason, command)

        # 3. String commands must not contain shell metacharacters.
        if isinstance(command, str):
            metachar_reason = self._check_metacharacters(raw)
            if metachar_reason:
                return self._result(False, metachar_reason, command)

        # 4. Validate executable against scope whitelist.
        executable = Path(tokens[0]).name.lower()
        if executable not in self._scope_commands[scope]:
            return self._result(
                False,
                f"Command {executable!r} is not allowed in {scope!r} scope",
                command,
            )

        # 4. Path traversal checks for filesystem-related arguments.
        path_reason = self._check_paths(tokens, roots, scope)
        if path_reason:
            return self._result(False, path_reason, command)

        # 5. Network scope URL checks for curl.
        if scope == "network" and executable == "curl":
            url_reason = self._check_curl_urls(tokens)
            if url_reason:
                return self._result(False, url_reason, command)

        return self._result(True, None, sanitized)

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    def _normalize_roots(self, allowed_paths: list[Path] | None) -> list[Path]:
        if allowed_paths is None:
            return [self.default_workspace]
        roots = [Path(p).resolve() for p in allowed_paths]
        return roots

    def _result(self, ok: bool, reason: str | None, command: str | list[str]) -> dict:
        sanitized = (
            command
            if isinstance(command, str)
            else " ".join(shlex.quote(str(t)) for t in command)
        )
        return {"ok": ok, "reason": reason, "command": sanitized}

    def _check_metacharacters(self, raw: str) -> str | None:
        for pattern in self._metachar_regex:
            if pattern.search(raw):
                return f"Shell metacharacter detected: {pattern.pattern!r}"
        return None

    def _check_dangerous_patterns(self, raw: str) -> str | None:
        for pattern in self._dangerous_regex:
            if pattern.search(raw):
                return f"Dangerous pattern blocked: {pattern.pattern!r}"
        return None

    def _check_paths(
        self, tokens: list[str], roots: list[Path], scope: str
    ) -> str | None:
        for token in tokens[1:]:
            if token == "-" or token.startswith("-"):
                # skip flags and stdin marker
                continue
            if ".." in token:
                return f"Path traversal detected: {token!r}"
            if token.startswith("http://") or token.startswith("https://"):
                # URLs are handled separately in network scope.
                continue
            if self._is_absolute(token):
                resolved = Path(token).resolve()
                if not any(self._is_contained(resolved, root) for root in roots):
                    return f"Absolute path outside allowed roots: {token!r}"
            elif self._has_separator(token):
                # Relative path containing separators: ensure it resolves
                # inside at least one allowed root.
                rel_resolved = self._resolve_relative(token, roots)
                if rel_resolved is None:
                    return f"Relative path escapes allowed roots: {token!r}"
        return None

    def _check_curl_urls(self, tokens: list[str]) -> str | None:
        if not self.allowed_urls:
            return None
        for token in tokens[1:]:
            if token.startswith("http://") or token.startswith("https://"):
                normalized = token.rstrip("/")
                if not any(
                    normalized.startswith(allowed) for allowed in self.allowed_urls
                ):
                    return f"URL not in allowed list: {token!r}"
        return None

    @staticmethod
    def _is_absolute(token: str) -> bool:
        return token.startswith("/") or (len(token) > 1 and token[1] == ":")

    @staticmethod
    def _has_separator(token: str) -> bool:
        return "/" in token or "\\" in token

    @staticmethod
    def _is_contained(path: Path, root: Path) -> bool:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            return False

    @staticmethod
    def _resolve_relative(token: str, roots: list[Path]) -> Path | None:
        for root in roots:
            candidate = (root / token).resolve()
            if SandboxValidator._is_contained(candidate, root):
                return candidate
        return None
