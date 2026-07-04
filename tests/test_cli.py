"""Tests for the Infinity CLI commands."""

from unittest.mock import patch

import httpx
from typer.testing import CliRunner

from inf.cli.main import app


runner = CliRunner()


def test_app_has_ask_command():
    result = runner.invoke(app, ["ask", "hello", "--dry-run"])
    assert result.exit_code == 0
    assert "Dry-run ask" in result.output
    assert "hello" in result.output


def test_app_has_run_command():
    result = runner.invoke(app, ["run", "build a thing", "--dry-run"])
    assert result.exit_code == 0
    assert "Dry-run run" in result.output
    assert "build a thing" in result.output


def test_app_has_status_command():
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0
    assert "not started" in result.output


def test_app_has_config_command():
    result = runner.invoke(app, ["config", "--dry-run"])
    assert result.exit_code == 0
    assert "Dry-run config" in result.output


def test_ask_without_api_key_warns():
    result = runner.invoke(app, ["ask", "what is ai?"])
    assert result.exit_code == 1
    assert "No API key configured" in result.output
    assert "infinity config" in result.output


def test_run_without_dry_run_shows_live(monkeypatch):
    monkeypatch.setenv("INFINITY_API_KEY_OPENAI", "sk-test-key")
    result = runner.invoke(app, ["run", "deploy", "--no-confirm"])
    assert result.exit_code == 0
    assert "Run complete" in result.output


def test_status_watch_flag():
    result = runner.invoke(app, ["status", "--watch"])
    assert result.exit_code == 0
    assert "Watch mode: True" in result.output


def test_config_help():
    result = runner.invoke(app, ["config", "--help"])
    assert result.exit_code == 0
    assert "API key" in result.output or "provider" in result.output.lower()


class FakeResponse:
    def __init__(self, status_code: int, json_data: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._json = json_data or {}
        self.text = text or (__import__("json").dumps(json_data))

    def json(self):
        return self._json


class FakeAsyncClient:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    async def post(self, url: str, **kwargs):
        kwargs.pop("timeout", None)
        self.requests.append(httpx.Request("POST", url, **kwargs))
        return self.responses.pop(0)

    async def get(self, url: str, **kwargs):
        kwargs.pop("timeout", None)
        self.requests.append(httpx.Request("GET", url, **kwargs))
        return self.responses.pop(0)

    async def aclose(self):
        pass


def test_ask_with_fake_provider(monkeypatch):
    monkeypatch.setenv("INFINITY_API_KEY_OPENAI", "sk-test-key")

    class FakeProvider:
        name = "openai"

        async def chat(self, messages, model=None, **kwargs):
            return "Hi there"

    monkeypatch.setattr("inf.cli.main.get_provider", lambda provider_id, **kwargs: FakeProvider())

    result = runner.invoke(app, ["ask", "hello"])
    assert result.exit_code == 0
    assert "Hi there" in result.output


def test_config_with_mocked_questionary_and_validation(monkeypatch, tmp_path):
    monkeypatch.setenv("INFINITY_API_KEY_OPENAI", "")
    env_file = tmp_path / ".env"
    gitignore = tmp_path / ".gitignore"
    monkeypatch.setattr("inf.config.keys.ApiKeyManager.ENV_FILE", str(env_file))
    monkeypatch.setattr("inf.config.keys.ApiKeyManager.GITIGNORE", str(gitignore))

    FakeAsyncClient([
        FakeResponse(200, {"data": []}),
    ])

    class DummyProvider:
        async def validate(self, api_key: str) -> bool:
            return True

    def fake_get_provider(provider_id, **kwargs):
        return DummyProvider()

    monkeypatch.setattr("inf.config.keys.get_provider", fake_get_provider)

    with patch("questionary.text") as mock_text:
        mock_text.return_value.ask.return_value = "sk-" + "x" * 45
        result = runner.invoke(app, ["config"], env={"INFINITY_API_KEY_OPENAI": ""})

    assert result.exit_code == 0
    assert "API key for provider 'openai' stored" in result.output
    assert env_file.exists()
    assert "INFINITY_API_KEY_OPENAI" in env_file.read_text()
