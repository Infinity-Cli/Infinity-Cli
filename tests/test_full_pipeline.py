"""Full-pipeline integration test for Infinity-Cli sync with Infinity-api."""

import json

import httpx
import pytest
from typer.testing import CliRunner

from inf.cli.main import app

runner = CliRunner()


@pytest.fixture
def mock_sync_api(monkeypatch):
    """Route all httpx.AsyncClient requests through a local mock Infinity-api."""
    statuses = {}
    logs = []
    commands = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = request.url
        path = url.path
        method = request.method

        if method == "POST" and path == "/api/chat":
            return httpx.Response(200, json={"message": {"content": "mocked plan"}})
        if method == "GET" and path == "/api/tags":
            return httpx.Response(
                200, json={"models": [{"name": "qwen2.5-coder:7b"}]}
            )

        if method == "POST" and path.startswith("/status/"):
            runtime_id = path.split("/")[-1]
            body = json.loads(request.content) if request.content else {}
            statuses[runtime_id] = body
            return httpx.Response(200, json=body)

        if method == "POST" and path == "/logs/":
            body = json.loads(request.content) if request.content else {}
            logs.append(body)
            return httpx.Response(200, json={"id": str(len(logs)), "log": body})

        if method == "GET" and path == "/commands/":
            status = url.params.get("status")
            matched = (
                [c for c in commands if c.get("status") == status]
                if status
                else commands
            )
            return httpx.Response(200, json=matched)

        if method == "POST" and path == "/commands/":
            body = json.loads(request.content) if request.content else {}
            body.setdefault("status", "pending")
            body["id"] = str(len(commands) + 1)
            commands.append(body)
            return httpx.Response(200, json={"id": body["id"], "command": body})

        if method == "PATCH" and path.startswith("/commands/"):
            command_id = path.split("/")[-1]
            body = json.loads(request.content) if request.content else {}
            for command in commands:
                if command.get("id") == command_id:
                    command.update(body)
                    return httpx.Response(200, json=command)
            return httpx.Response(404, json={"detail": "not found"})

        return httpx.Response(404, json={"detail": f"no route {method} {path}"})

    original_init = httpx.AsyncClient.__init__

    def patched_init(self, *args, **kwargs):
        if "transport" not in kwargs:
            kwargs["transport"] = httpx.MockTransport(handler)
            kwargs.setdefault("base_url", "http://testserver")
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)

    return type("MockApi", (), {"statuses": statuses, "logs": logs, "commands": commands})()


@pytest.fixture
def mock_ollama(monkeypatch):
    """Monkey-patch httpx so the default Ollama client succeeds."""

    def fake_post(self, url, **kwargs):
        return httpx.Response(200, json={"message": {"content": "mocked-ollama-plan"}})

    async def fake_get(self, url, **kwargs):
        return httpx.Response(
            200, json={"models": [{"name": "qwen2.5-coder:7b"}]}
        )

    monkeypatch.setattr("httpx.AsyncClient.post", fake_post)
    monkeypatch.setattr("httpx.AsyncClient.get", fake_get)


def test_run_pushes_status_and_claims_remote_pause_command(
    mock_sync_api, mock_ollama, tmp_path, monkeypatch
):
    """`infinity run --enable-sync` registers, pushes logs, and obeys a pause command."""
    monkeypatch.chdir(tmp_path)

    # Pre-populate a remote pause command before the run starts.
    mock_sync_api.commands.append(
        {
            "id": "cmd-pause-1",
            "runtime_id": "any",
            "action": "pause",
            "type": "pause",
            "payload": {},
            "status": "pending",
        }
    )

    result = runner.invoke(
        app,
        [
            "run",
            "build a simple api",
            "--no-confirm",
            "--max-agents",
            "3",
            "--enable-sync",
            "--sync-base-url",
            "http://testserver",
        ],
    )

    # The run should complete without an unhandled exception.
    assert result.exit_code == 0, result.output
    assert "Run complete" in result.output

    # The runtime was registered with Infinity-api.
    assert len(mock_sync_api.statuses) >= 1

    # At least one log was pushed.
    assert len(mock_sync_api.logs) >= 1

    # The pre-populated pause command was claimed.
    pause_command = next(
        (c for c in mock_sync_api.commands if c.get("id") == "cmd-pause-1"), None
    )
    assert pause_command is not None
    assert pause_command.get("status") == "claimed"
