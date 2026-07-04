"""Tests for the Infinity CLI security/secret module."""

from __future__ import annotations

import getpass
from pathlib import Path


from inf.security import EnvWriter, GitignoreGuard, SecretScanner, prompt_for_secret


class TestSecretScanner:
    def test_scan_text_detects_openai_key(self):
        scanner = SecretScanner()
        findings = scanner.scan_text("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\n")
        assert len(findings) == 1
        assert findings[0]["type"] == "openai_api_key"
        assert findings[0]["value"].startswith("sk-")
        assert findings[0]["value"].endswith("...")
        assert findings[0]["line"] == 1
        assert findings[0]["severity"] == "high"

    def test_scan_text_detects_anthropic_key(self):
        scanner = SecretScanner()
        text = "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234-abcDEF"
        findings = scanner.scan_text(text)
        types = [f["type"] for f in findings]
        assert "anthropic_api_key" in types
        anthropic_findings = [f for f in findings if f["type"] == "anthropic_api_key"]
        assert anthropic_findings[0]["severity"] == "high"

    def test_scan_text_detects_google_key(self):
        scanner = SecretScanner()
        text = "GOOGLE_API_KEY=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        findings = scanner.scan_text(text)
        assert any(f["type"] == "google_api_key" for f in findings)
        google_findings = [f for f in findings if f["type"] == "google_api_key"]
        assert google_findings[0]["value"].startswith("AIzaSy")
        assert google_findings[0]["value"].endswith("...")
        assert google_findings[0]["severity"] == "high"

    def test_scan_text_detects_generic_token(self):
        scanner = SecretScanner()
        text = "TOKEN=Ab3dEf7gH1jKlMnOpQrStUvWxYz23456"
        findings = scanner.scan_text(text)
        generic = [f for f in findings if f["type"] == "generic_token"]
        assert len(generic) == 1
        assert generic[0]["value"].endswith("...")
        assert generic[0]["severity"] == "medium"

    def test_scan_text_reports_line_numbers(self):
        scanner = SecretScanner()
        text = "first line\nOPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\nthird line"
        findings = scanner.scan_text(text)
        assert findings[0]["line"] == 2

    def test_scan_file_reports_path_and_line(self, tmp_path: Path):
        scanner = SecretScanner()
        file_path = tmp_path / "config.env"
        file_path.write_text("SECRET=sk-abcdefghijklmnopqrstuvwxyz123456\n")
        findings = scanner.scan_file(file_path)
        assert len(findings) == 1
        assert findings[0]["path"] == str(file_path)
        assert findings[0]["line"] == 1

    def test_scan_directory_skips_ignored_dirs(self, tmp_path: Path):
        scanner = SecretScanner()
        (tmp_path / "__pycache__").mkdir()
        (tmp_path / "__pycache__" / "secrets.env").write_text(
            "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\n"
        )
        findings = scanner.scan_directory(tmp_path)
        assert not findings

    def test_scan_directory_includes_supported_files(self, tmp_path: Path):
        scanner = SecretScanner()
        (tmp_path / "app.py").write_text(
            "api_key = 'sk-abcdefghijklmnopqrstuvwxyz123456'\n"
        )
        findings = scanner.scan_directory(tmp_path)
        assert len(findings) == 1
        assert findings[0]["type"] == "openai_api_key"


class TestEnvWriter:
    def test_write_creates_file_and_sets_permissions(self, tmp_path: Path):
        import os

        env_path = tmp_path / ".env"
        writer = EnvWriter(env_path)
        writer.write("OPENAI_API_KEY", "sk-test")
        assert env_path.exists()
        assert env_path.read_text() == "OPENAI_API_KEY=sk-test\n"
        if os.name != "nt":
            mode = env_path.stat().st_mode & 0o777
            assert mode == 0o600

    def test_write_updates_existing_key(self, tmp_path: Path):
        env_path = tmp_path / ".env"
        writer = EnvWriter(env_path)
        writer.write("A", "1")
        writer.write("B", "2")
        writer.write("A", "updated")
        assert writer.read("A") == "updated"
        assert writer.read("B") == "2"

    def test_read_missing_key_returns_none(self, tmp_path: Path):
        env_path = tmp_path / ".env"
        writer = EnvWriter(env_path)
        writer.write("PRESENT", "value")
        assert writer.read("MISSING") is None

    def test_remove_key_rewrites_file(self, tmp_path: Path):
        env_path = tmp_path / ".env"
        writer = EnvWriter(env_path)
        writer.write("KEEP", "yes")
        writer.write("DROP", "no")
        removed = writer.remove("DROP")
        assert removed is True
        assert writer.read("DROP") is None
        assert writer.read("KEEP") == "yes"
        assert "KEEP=yes" in env_path.read_text()
        assert "DROP=no" not in env_path.read_text()

    def test_remove_missing_key_returns_false(self, tmp_path: Path):
        env_path = tmp_path / ".env"
        writer = EnvWriter(env_path)
        assert writer.remove("NOT_THERE") is False


class TestGitignoreGuard:
    def test_ensure_ignored_creates_gitignore(self, tmp_path: Path):
        guard = GitignoreGuard(tmp_path)
        guard.ensure_ignored([".env", "*.key"])
        gitignore = tmp_path / ".gitignore"
        assert gitignore.exists()
        content = gitignore.read_text()
        assert ".env" in content
        assert "*.key" in content

    def test_ensure_ignored_avoids_duplicates(self, tmp_path: Path):
        guard = GitignoreGuard(tmp_path)
        guard.ensure_ignored([".env"])
        guard.ensure_ignored([".env", "*.key"])
        content = (tmp_path / ".gitignore").read_text()
        assert content.count(".env") == 1

    def test_is_ignores_comments_and_whitespace(self, tmp_path: Path):
        gitignore = tmp_path / ".gitignore"
        gitignore.write_text("  .env  \n# this is a comment\n*.log\n")
        guard = GitignoreGuard(tmp_path)
        assert guard.is_ignored(".env") is True
        assert guard.is_ignored("*.log") is True
        assert guard.is_ignored("*.key") is False


class TestPromptForSecret:
    def test_prompt_for_secret_returns_value(self, monkeypatch):
        monkeypatch.setattr(getpass, "getpass", lambda prompt: "shh-secret")
        assert prompt_for_secret() == "shh-secret"

    def test_prompt_for_secret_returns_none_for_empty_input(self, monkeypatch):
        monkeypatch.setattr(getpass, "getpass", lambda prompt: "   ")
        assert prompt_for_secret("Enter key") is None


class TestConfirmOverwrite:
    def test_confirm_overwrite_returns_true_when_file_missing(self, tmp_path: Path):
        from inf.security.prompt import confirm_overwrite

        assert confirm_overwrite(tmp_path / "does_not_exist") is True

    def test_confirm_overwrite_uses_input_when_file_exists(self, tmp_path: Path, monkeypatch):
        from inf.security.prompt import confirm_overwrite

        existing = tmp_path / "exists"
        existing.write_text("data")
        monkeypatch.setattr("builtins.input", lambda prompt: "y")
        assert confirm_overwrite(existing) is True
