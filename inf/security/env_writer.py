"""Secure .env file writer and reader."""

from __future__ import annotations

from pathlib import Path


class EnvWriter:
    """Write, read, and remove entries in a ``.env`` style file.

    The file is created with restrictive permissions (0o600) on Unix-like
    systems. On Windows, permission-setting failures are ignored.
    """

    def __init__(self, path: Path):
        self.path = Path(path)

    def _parse(self) -> dict[str, str]:
        """Return a mapping of KEY -> value from the existing file."""
        entries: dict[str, str] = {}
        if not self.path.exists():
            return entries
        for raw_line in self.path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            entries[key] = value
        return entries

    def _write(self, entries: dict[str, str]) -> None:
        """Rewrite the file from ``entries`` preserving simple order."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lines = [f"{key}={value}" for key, value in entries.items()]
        self.path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        self._restrict_permissions()

    def _restrict_permissions(self) -> None:
        """Set file mode to owner-read/write only on supported platforms."""
        try:
            self.path.chmod(0o600)
        except (NotImplementedError, OSError):
            # Windows or filesystems that do not support Unix permissions.
            pass

    def write(self, key: str, value: str) -> None:
        """Append or update ``KEY=value`` in the ``.env`` file.

        Existing entries are preserved.
        """
        entries = self._parse()
        entries[key] = value
        self._write(entries)

    def read(self, key: str) -> str | None:
        """Read ``key`` from the file, or ``None`` if absent."""
        return self._parse().get(key)

    def remove(self, key: str) -> bool:
        """Remove ``key`` from the file and rewrite it.

        Returns:
            ``True`` if the key existed and was removed.
        """
        entries = self._parse()
        if key not in entries:
            return False
        del entries[key]
        self._write(entries)
        return True
