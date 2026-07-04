"""Tests for the Skylos-inspired sandbox validator."""

from __future__ import annotations

from pathlib import Path

from inf.security.sandbox import SandboxValidator


class TestSandboxValidator:
    """Comprehensive tests for :class:`SandboxValidator`."""

    def test_whitelisted_command_passes(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        result = validator.validate("ls -la", allowed_paths=[tmp_path])
        assert result["ok"] is True
        assert result["reason"] is None
        assert result["command"] == "ls -la"

    def test_blacklisted_command_rejected(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        result = validator.validate("rm -rf /", allowed_paths=[tmp_path])
        assert result["ok"] is False
        assert result["reason"] is not None
        assert "Dangerous pattern" in result["reason"]

    def test_path_traversal_dotdot_rejected(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        result = validator.validate("cat ../secret.txt", allowed_paths=[tmp_path])
        assert result["ok"] is False
        assert "Path traversal" in result["reason"]

    def test_absolute_path_outside_allowed_roots_rejected(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        result = validator.validate("cat /etc/passwd", allowed_paths=[tmp_path])
        assert result["ok"] is False
        assert "Absolute path outside allowed roots" in result["reason"]

    def test_absolute_path_inside_allowed_roots_passes(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        inner = tmp_path / "inner"
        inner.mkdir()
        (inner / "file.txt").write_text("hello")
        result = validator.validate(f"cat {inner}/file.txt", allowed_paths=[tmp_path])
        assert result["ok"] is True

    def test_shell_metacharacters_rejected(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        metachar_commands = [
            "echo hello; rm -rf /",
            "echo hello && rm -rf /",
            "echo hello || rm -rf /",
            "echo hello | cat",
            "echo `whoami`",
            "echo $(whoami)",
        ]
        for cmd in metachar_commands:
            result = validator.validate(cmd, allowed_paths=[tmp_path])
            assert result["ok"] is False, f"Expected rejection for: {cmd}"
            reason = result["reason"].lower()
            assert "metacharacter" in reason or "dangerous pattern" in reason, reason

    def test_allowed_paths_validation_for_read(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        (tmp_path / "allowed.txt").write_text("ok")
        result = validator.validate(
            "cat allowed.txt", allowed_paths=[tmp_path], scope="read"
        )
        assert result["ok"] is True

    def test_allowed_paths_validation_for_write(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        result = validator.validate(
            "mkdir subdir", allowed_paths=[tmp_path], scope="write"
        )
        assert result["ok"] is True

        result = validator.validate(
            "cp file1.txt subdir/file2.txt", allowed_paths=[tmp_path], scope="write"
        )
        assert result["ok"] is True

    def test_permission_scope_read_vs_write(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)

        read_ok = validator.validate(
            "cat file.txt", allowed_paths=[tmp_path], scope="read"
        )
        assert read_ok["ok"] is True

        read_blocked = validator.validate(
            "mkdir newdir", allowed_paths=[tmp_path], scope="read"
        )
        assert read_blocked["ok"] is False
        assert "not allowed in 'read' scope" in read_blocked["reason"]

        write_ok = validator.validate(
            "mkdir newdir", allowed_paths=[tmp_path], scope="write"
        )
        assert write_ok["ok"] is True

    def test_permission_scope_network(self, tmp_path: Path):
        validator = SandboxValidator(
            default_workspace=tmp_path,
            allowed_urls=["https://api.example.com"],
        )

        ok = validator.validate(
            "curl https://api.example.com/v1/status",
            allowed_paths=[tmp_path],
            scope="network",
        )
        assert ok["ok"] is True

        blocked_url = validator.validate(
            "curl https://evil.example.com/data",
            allowed_paths=[tmp_path],
            scope="network",
        )
        assert blocked_url["ok"] is False
        assert "URL not in allowed list" in blocked_url["reason"]

        wrong_scope = validator.validate(
            "curl https://api.example.com/v1/status",
            allowed_paths=[tmp_path],
            scope="read",
        )
        assert wrong_scope["ok"] is False
        assert "not allowed in 'read' scope" in wrong_scope["reason"]

    def test_runtime_allow_deny_mutation(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)

        # By default ``tar`` is not allowed.
        blocked = validator.validate("tar -xvf archive.tar", allowed_paths=[tmp_path])
        assert blocked["ok"] is False

        validator.allow("tar")
        allowed = validator.validate("tar -xvf archive.tar", allowed_paths=[tmp_path])
        assert allowed["ok"] is True

        validator.deny("tar")
        denied_again = validator.validate(
            "tar -xvf archive.tar", allowed_paths=[tmp_path]
        )
        assert denied_again["ok"] is False

    def test_validate_returns_expected_dict_shape(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        ok_result = validator.validate("echo hello", allowed_paths=[tmp_path])
        assert set(ok_result.keys()) == {"ok", "reason", "command"}
        assert isinstance(ok_result["ok"], bool)
        assert ok_result["reason"] is None
        assert isinstance(ok_result["command"], str)

        bad_result = validator.validate("rm -rf /", allowed_paths=[tmp_path])
        assert set(bad_result.keys()) == {"ok", "reason", "command"}
        assert bad_result["ok"] is False
        assert isinstance(bad_result["reason"], str)
        assert isinstance(bad_result["command"], str)

    def test_list_input_validated(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        result = validator.validate(["python", "script.py"], allowed_paths=[tmp_path])
        assert result["ok"] is True
        assert result["command"] == "python script.py"

    def test_list_input_with_bad_command_rejected(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        result = validator.validate(["rm", "-rf", "/"], allowed_paths=[tmp_path])
        assert result["ok"] is False
        assert "Dangerous pattern" in result["reason"]

    def test_write_scope_allows_rm_in_allowed_paths(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        (tmp_path / "old.txt").write_text("data")
        result = validator.validate(
            "rm old.txt", allowed_paths=[tmp_path], scope="write"
        )
        assert result["ok"] is True

    def test_default_workspace_used_when_allowed_paths_omitted(self, tmp_path: Path):
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        validator = SandboxValidator(default_workspace=workspace)
        result = validator.validate("ls -la")
        assert result["ok"] is True

    def test_unknown_scope_rejected(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        result = validator.validate(
            "echo hello", allowed_paths=[tmp_path], scope="admin"
        )
        assert result["ok"] is False
        assert "Unknown permission scope" in result["reason"]

    def test_dangerous_mkfs_rejected(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        result = validator.validate("mkfs.ext4 /dev/sda1", allowed_paths=[tmp_path])
        assert result["ok"] is False
        assert "Dangerous pattern" in result["reason"]

    def test_dangerous_fork_bomb_rejected(self, tmp_path: Path):
        validator = SandboxValidator(default_workspace=tmp_path)
        result = validator.validate(":(){ :|: & };:", allowed_paths=[tmp_path])
        assert result["ok"] is False
        assert "Dangerous pattern" in result["reason"]
