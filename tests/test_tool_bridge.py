"""Tests for the /tools/execute bridge endpoint."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

from inf.server.app import app


class _DummyToolBridgeHandler(BaseHTTPRequestHandler):
    """Minimal handler that echoes back the tool/input as a successful result."""

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/execute":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            data = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return

        tool = data.get("tool")
        input_data = data.get("input", {})

        if tool == "shell" and input_data.get("command") == "echo blocked":
            response = {"success": False, "error": "blocked by policy"}
        else:
            response = {
                "success": True,
                "output": f"hello from ts: {tool}={input_data}",
            }

        payload = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):  # noqa: A002
        pass


def _start_dummy_server():
    server = HTTPServer(("127.0.0.1", 0), _DummyToolBridgeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    return server, port


@pytest.fixture
def dummy_bridge(monkeypatch):
    """Start a dummy TS bridge server and configure the app to use it."""
    server, port = _start_dummy_server()
    url = f"http://127.0.0.1:{port}"
    monkeypatch.setenv("INFINITY_TOOL_BRIDGE_URL", url)
    yield url
    server.shutdown()
    server.server_close()


def test_tools_execute_forwards_to_bridge(dummy_bridge):
    """The /tools/execute endpoint forwards requests to the TS bridge."""
    client = TestClient(app)
    response = client.post(
        "/tools/execute",
        json={"tool": "shell", "input": {"command": "echo hello"}},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "hello from ts" in data["output"]


def test_tools_execute_propagates_bridge_error(dummy_bridge):
    """Errors returned by the TS bridge are propagated to the caller."""
    client = TestClient(app)
    response = client.post(
        "/tools/execute",
        json={"tool": "shell", "input": {"command": "echo blocked"}},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "blocked" in data["error"]


def test_tools_execute_unreachable_bridge(monkeypatch):
    """When the bridge is unreachable, the endpoint returns a graceful error."""
    monkeypatch.setenv("INFINITY_TOOL_BRIDGE_URL", "http://127.0.0.1:1")
    client = TestClient(app)
    response = client.post(
        "/tools/execute",
        json={"tool": "shell", "input": {"command": "echo hello"}},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "unreachable" in data["error"].lower() or "refused" in data["error"].lower()
