"""Ensure sensitive files are ignored by Git."""

from __future__ import annotations

from pathlib import Path


class GitignoreGuard:
    """Manage ``.gitignore`` entries for a project."""

    def __init__(self, project_root: Path):
        self.project_root = Path(project_root)
        self.gitignore = self.project_root / ".gitignore"

    def _existing_patterns(self) -> set[str]:
        """Return normalized patterns currently listed in ``.gitignore``."""
        if not self.gitignore.exists():
            return set()
        patterns: set[str] = set()
        for line in self.gitignore.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            patterns.add(stripped)
        return patterns

    def is_ignored(self, pattern: str) -> bool:
        """Return ``True`` if ``pattern`` is already present (ignoring comments/whitespace)."""
        return pattern.strip() in self._existing_patterns()

    def ensure_ignored(self, patterns: list[str]) -> None:
        """Append any missing ``patterns`` to ``.gitignore``, creating it if needed."""
        existing = self._existing_patterns()
        missing = [p for p in patterns if p.strip() and p.strip() not in existing]
        if not missing:
            return

        self.gitignore.parent.mkdir(parents=True, exist_ok=True)
        if self.gitignore.exists():
            content = self.gitignore.read_text(encoding="utf-8")
            if content and not content.endswith("\n"):
                content += "\n"
        else:
            content = ""

        content += "\n".join(missing) + "\n"
        self.gitignore.write_text(content, encoding="utf-8")
