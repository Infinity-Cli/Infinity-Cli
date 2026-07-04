"""Tests for workspace isolation and management."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from inf.workspaces import WorkspaceManager


@pytest.fixture
def manager():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield WorkspaceManager(root=Path(tmpdir) / "workspace")


def test_ensure_creates_per_agent_directories_and_subdirs(manager: WorkspaceManager):
    agent_id = "agent-001"
    workspace = manager.ensure(agent_id)

    assert workspace.exists()
    assert workspace.is_dir()
    assert workspace.name == agent_id

    expected_subdirs = {"src", "tests", "output", "state"}
    actual_subdirs = {entry.name for entry in workspace.iterdir() if entry.is_dir()}
    assert actual_subdirs == expected_subdirs


def test_path_for_returns_absolute_path_under_workspace(manager: WorkspaceManager):
    agent_id = "agent-002"
    manager.ensure(agent_id)

    target = manager.path_for(agent_id, "src", "main.py")

    assert target.is_absolute()
    assert target.parts[-3:] == ("agent-002", "src", "main.py")


def test_path_for_rejects_escape_attempts_with_dotdot(manager: WorkspaceManager):
    agent_id = "agent-003"
    manager.ensure(agent_id)

    with pytest.raises(ValueError, match="Path traversal detected"):
        manager.path_for(agent_id, "..", "outside.txt")

    with pytest.raises(ValueError, match="Path traversal detected"):
        manager.path_for(agent_id, "src", "..", "..", "etc", "passwd")


def test_path_for_rejects_escape_attempts_in_absolute_parts(manager: WorkspaceManager):
    agent_id = "agent-004"
    manager.ensure(agent_id)

    outside = Path("/tmp/outside.txt")
    with pytest.raises(ValueError, match="Path traversal detected"):
        manager.path_for(agent_id, str(outside))


def test_path_for_rejects_invalid_agent_ids(manager: WorkspaceManager):
    with pytest.raises(ValueError, match="agent_id must be a non-empty string"):
        manager.path_for("", "file.txt")

    with pytest.raises(ValueError, match="Invalid agent_id"):
        manager.path_for("../attacker", "file.txt")


def test_write_and_read_file_roundtrip(manager: WorkspaceManager):
    agent_id = "agent-005"
    manager.ensure(agent_id)
    content = "print('hello, world')"

    written = manager.write_file(agent_id, "src/main.py", content)

    assert written.exists()
    assert written.read_text(encoding="utf-8") == content
    assert manager.read_file(agent_id, "src/main.py") == content


def test_write_file_creates_parent_directories(manager: WorkspaceManager):
    agent_id = "agent-006"
    manager.ensure(agent_id)

    manager.write_file(agent_id, "src/deeply/nested/module.py", "x = 1")

    assert (manager.path_for(agent_id, "src/deeply/nested/module.py")).exists()


def test_read_file_not_found(manager: WorkspaceManager):
    agent_id = "agent-007"
    manager.ensure(agent_id)

    with pytest.raises(FileNotFoundError):
        manager.read_file(agent_id, "missing.txt")


def test_list_outputs_lists_files_in_output(manager: WorkspaceManager):
    agent_id = "agent-008"
    manager.ensure(agent_id)
    manager.write_file(agent_id, "output/report.md", "# Report")
    manager.write_file(agent_id, "output/plots/chart.png", "fake-image")
    manager.write_file(agent_id, "src/main.py", "x = 1")

    outputs = manager.list_outputs(agent_id)

    assert "report.md" in outputs
    assert "plots/chart.png" in outputs
    assert "src/main.py" not in outputs


def test_list_outputs_empty_for_new_agent(manager: WorkspaceManager):
    agent_id = "agent-009"
    manager.ensure(agent_id)

    assert manager.list_outputs(agent_id) == []


def test_clear_removes_workspace_tree(manager: WorkspaceManager):
    agent_id = "agent-010"
    workspace = manager.ensure(agent_id)
    manager.write_file(agent_id, "state/data.json", "{}")

    manager.clear(agent_id)

    assert not workspace.exists()


def test_list_agents_returns_agent_ids(manager: WorkspaceManager):
    manager.ensure("alpha")
    manager.ensure("beta")

    agents = manager.list_agents()

    assert agents == ["alpha", "beta"]


def test_list_agents_ignores_hidden_directories(manager: WorkspaceManager):
    manager.ensure("visible")
    hidden = manager.root / ".hidden"
    hidden.mkdir(parents=True)

    assert manager.list_agents() == ["visible"]


def test_list_agents_returns_empty_when_root_missing():
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir) / "does_not_exist_yet"
        manager = WorkspaceManager(root=root)
        assert manager.list_agents() == []


def test_ensure_resolves_existing_workspace(manager: WorkspaceManager):
    agent_id = "agent-011"
    first = manager.ensure(agent_id)
    second = manager.ensure(agent_id)

    assert first == second
    assert (second / "output").exists()


def test_default_root_uses_infinity_home():
    with tempfile.TemporaryDirectory() as tmpdir:
        home = Path(tmpdir) / "home"
        home.mkdir()
        settings = type("Settings", (), {"infinity_home": home})()
        manager = WorkspaceManager(settings=settings)
        assert manager.root == (home / "workspace").resolve()
