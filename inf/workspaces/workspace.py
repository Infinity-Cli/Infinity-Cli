"""Workspace management for isolated per-agent directories."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Optional

from inf.core.config import Settings, load_settings


class WorkspaceManager:
    """Create, isolate, and manage per-agent workspace directories.

    Each agent receives a dedicated directory under the workspace root with
    predefined subdirectories for source code, tests, outputs, and state.
    All file operations are resolved and validated so that relative paths
    cannot escape the agent's workspace.
    """

    SUBDIRECTORIES = ("src", "tests", "output", "state")

    def __init__(
        self,
        root: Optional[Path] = None,
        settings: Optional[Settings] = None,
    ) -> None:
        """Initialize the workspace manager.

        Args:
            root: Explicit workspace root directory. Takes precedence if given.
            settings: Application settings used to derive the root when ``root``
                is not provided. Defaults to ``settings.infinity_home / "workspace"``.
        """
        if root is not None:
            self.root = Path(root).expanduser().resolve()
        else:
            cfg = settings or load_settings()
            self.root = Path(cfg.infinity_home).expanduser().resolve() / "workspace"

    def _agent_dir(self, agent_id: str) -> Path:
        """Return the resolved workspace directory for an agent."""
        if not agent_id or not isinstance(agent_id, str):
            raise ValueError("agent_id must be a non-empty string")
        if any(part in (".", "..", "") for part in Path(agent_id).parts):
            raise ValueError(f"Invalid agent_id: {agent_id!r}")
        return self.root / agent_id

    def ensure(self, agent_id: str) -> Path:
        """Create ``workspace/<agent_id>/`` and its standard subdirectories.

        Returns the resolved agent workspace path.
        """
        workspace = self._agent_dir(agent_id)
        workspace.mkdir(parents=True, exist_ok=True)
        for subdir in self.SUBDIRECTORIES:
            (workspace / subdir).mkdir(exist_ok=True)
        return workspace.resolve()

    def path_for(self, agent_id: str, *parts: str | Path) -> Path:
        """Resolve ``parts`` under the agent workspace and enforce boundaries.

        Raises:
            ValueError: If the resolved path escapes the agent workspace or if
                any part traverses above the workspace root.
        """
        workspace = self._agent_dir(agent_id).resolve()
        if not parts:
            return workspace

        # Validate each part for traversal attempts before resolving.
        for part in parts:
            part_path = Path(part)
            if any(segment in (".", "..") for segment in part_path.parts):
                raise ValueError(f"Path traversal detected in part: {part!r}")

        target = (workspace.joinpath(*parts)).resolve()
        # Use string prefix check on resolved paths to catch symlink escapes.
        if not str(target).startswith(str(workspace)):
            raise ValueError(
                f"Path traversal detected: '{target}' is outside workspace '{workspace}'"
            )
        return target

    def write_file(self, agent_id: str, relative_path: str, content: str) -> Path:
        """Write ``content`` to ``relative_path`` inside the agent workspace."""
        target = self.path_for(agent_id, relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return target

    def read_file(self, agent_id: str, relative_path: str) -> str:
        """Read text from ``relative_path`` inside the agent workspace."""
        target = self.path_for(agent_id, relative_path)
        if not target.is_file():
            raise FileNotFoundError(f"File not found: {target}")
        return target.read_text(encoding="utf-8")

    def list_outputs(self, agent_id: str) -> list[str]:
        """List files in the agent's ``output/`` directory.

        Returns a sorted list of file paths relative to ``output/``.
        """
        output_dir = self.path_for(agent_id, "output")
        if not output_dir.exists():
            return []

        files: list[str] = []
        for path in output_dir.rglob("*"):
            if path.is_file():
                files.append(str(path.relative_to(output_dir).as_posix()))
        return sorted(files)

    def clear(self, agent_id: str) -> None:
        """Remove the entire workspace tree for an agent."""
        workspace = self._agent_dir(agent_id)
        if workspace.exists():
            shutil.rmtree(workspace)

    def list_agents(self) -> list[str]:
        """Return top-level agent directory names under the workspace root."""
        if not self.root.exists():
            return []
        return sorted(
            entry.name
            for entry in self.root.iterdir()
            if entry.is_dir() and not entry.name.startswith(".")
        )
