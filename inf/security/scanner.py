"""Secret scanner for detecting common API keys and high-entropy tokens."""

from __future__ import annotations

import os
import re
from pathlib import Path


# Regex patterns for known secret types.
_PATTERN_OPENAI = re.compile(r"sk-[a-zA-Z0-9]{32,}")
_PATTERN_ANTHROPIC = re.compile(r"sk-ant-[a-zA-Z0-9_-]{32,}")
_PATTERN_GOOGLE = re.compile(r"AIza[0-9A-Za-z_-]{35}")

# Generic high-entropy token: a continuous alphanumeric string of at least 32 chars.
_PATTERN_GENERIC = re.compile(r"[a-zA-Z0-9]{32,}")

# Directories to skip when scanning recursively.
_SKIP_DIRS = frozenset(
    {
        "__pycache__",
        ".venv",
        ".git",
        "node_modules",
        ".pytest_cache",
        "build",
        "dist",
        "venv",
        "env",
    }
)

_SCAN_EXTENSIONS = frozenset({".py", ".env", ".json", ".yaml", ".yml", ".toml", ".md", ".txt"})


def _truncate(value: str, limit: int = 16) -> str:
    """Return value truncated to ``limit`` characters with an ellipsis."""
    if len(value) <= limit:
        return value
    return value[:limit] + "..."


def _entropy_ok(token: str) -> bool:
    """Quick heuristic: require at least one digit and one letter."""
    return any(c.isdigit() for c in token) and any(c.isalpha() for c in token)


class SecretScanner:
    """Scan text, files, and directories for likely secret values."""

    def scan_text(self, text: str, path: str | Path = "<text>") -> list[dict]:
        """Scan ``text`` for common secret patterns.

        Args:
            text: The text content to scan.
            path: Optional path label for findings.

        Returns:
            A list of finding dictionaries.
        """
        findings: list[dict] = []
        seen: set[tuple[str, int]] = set()

        for line_number, line in enumerate(text.splitlines(), start=1):
            known_spans: list[tuple[int, int]] = []

            # OpenAI-style keys
            for match in _PATTERN_OPENAI.finditer(line):
                value = match.group(0)
                key = (value, line_number)
                if key not in seen and value.startswith("sk-") and not value.startswith("sk-ant-"):
                    seen.add(key)
                    known_spans.append(match.span())
                    findings.append(
                        {
                            "type": "openai_api_key",
                            "value": _truncate(value),
                            "path": str(path),
                            "line": line_number,
                            "severity": "high",
                        }
                    )

            # Anthropic keys
            for match in _PATTERN_ANTHROPIC.finditer(line):
                value = match.group(0)
                key = (value, line_number)
                if key not in seen:
                    seen.add(key)
                    known_spans.append(match.span())
                    findings.append(
                        {
                            "type": "anthropic_api_key",
                            "value": _truncate(value),
                            "path": str(path),
                            "line": line_number,
                            "severity": "high",
                        }
                    )

            # Google API keys
            for match in _PATTERN_GOOGLE.finditer(line):
                value = match.group(0)
                key = (value, line_number)
                if key not in seen:
                    seen.add(key)
                    known_spans.append(match.span())
                    findings.append(
                        {
                            "type": "google_api_key",
                            "value": _truncate(value),
                            "path": str(path),
                            "line": line_number,
                            "severity": "high",
                        }
                    )

            def _overlaps_known(span: tuple[int, int]) -> bool:
                start, end = span
                for ks, ke in known_spans:
                    if start < ke and end > ks:
                        return True
                return False

            # Generic high-entropy tokens
            for match in _PATTERN_GENERIC.finditer(line):
                value = match.group(0)
                key = (value, line_number)
                if key in seen or not _entropy_ok(value):
                    continue
                # Avoid re-reporting tokens that overlap known secret spans.
                if _overlaps_known(match.span()):
                    continue
                seen.add(key)
                findings.append(
                    {
                        "type": "generic_token",
                        "value": _truncate(value),
                        "path": str(path),
                        "line": line_number,
                        "severity": "medium",
                    }
                )

        return findings

    def scan_file(self, path: Path) -> list[dict]:
        """Read ``path`` and scan its contents.

        Args:
            path: The file to scan.

        Returns:
            A list of finding dictionaries with absolute file paths.
        """
        text = path.read_text(encoding="utf-8", errors="replace")
        findings = self.scan_text(text, path=path)
        for finding in findings:
            finding["path"] = str(path)
        return findings

    def scan_directory(self, path: Path) -> list[dict]:
        """Recursively scan ``path`` for secrets in source/text files.

        Args:
            path: The directory to scan.

        Returns:
            A list of finding dictionaries.
        """
        findings: list[dict] = []
        for root, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
            for filename in files:
                if Path(filename).suffix.lower() not in _SCAN_EXTENSIONS:
                    continue
                file_path = Path(root) / filename
                try:
                    findings.extend(self.scan_file(file_path))
                except (OSError, UnicodeDecodeError):
                    # Skip unreadable files (permissions or binary).
                    continue
        return findings
