"""Tests for the Infinity CLI local server."""

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from inf.server.app import app

client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_run_endpoint_returns_summary() -> None:
    """Test /run returns success and summary fields with mocked orchestrator."""
    mock_summary = {
        "success": True,
        "goal": "test goal",
        "completed": ["agent1", "agent2"],
        "failed": [],
    }

    with patch("inf.server.app.Orchestrator") as mock_orchestrator_class:
        mock_orchestrator = AsyncMock()
        mock_orchestrator.execute_goal = AsyncMock(return_value=mock_summary)
        mock_orchestrator_class.return_value = mock_orchestrator

        with patch("inf.server.app._create_model_router", new_callable=AsyncMock) as mock_router:
            mock_router.return_value = None

            response = client.post("/run", json={"goal": "test goal"})

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["goal"] == "test goal"
    assert "run_id" in data
    assert data["completed"] == ["agent1", "agent2"]
    assert data["failed"] == []


def test_run_endpoint_accepts_optional_params() -> None:
    """Test /run accepts max_agents, timeout, enable_sync, sync_base_url."""
    mock_summary = {
        "success": True,
        "goal": "test goal with params",
        "completed": [],
        "failed": [],
    }

    with patch("inf.server.app.Orchestrator") as mock_orchestrator_class:
        mock_orchestrator = AsyncMock()
        mock_orchestrator.execute_goal = AsyncMock(return_value=mock_summary)
        mock_orchestrator_class.return_value = mock_orchestrator

        with patch("inf.server.app._create_model_router", new_callable=AsyncMock) as mock_router:
            mock_router.return_value = None

            response = client.post(
                "/run",
                json={
                    "goal": "test goal with params",
                    "max_agents": 5,
                    "timeout": 1800,
                    "enable_sync": True,
                    "sync_base_url": "http://sync.example.com",
                },
            )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["goal"] == "test goal with params"
    assert "run_id" in data


def test_run_endpoint_handles_failure() -> None:
    """Test /run returns failed agents in summary."""
    mock_summary = {
        "success": False,
        "goal": "failing goal",
        "completed": ["agent1"],
        "failed": ["agent2", "agent3"],
    }

    with patch("inf.server.app.Orchestrator") as mock_orchestrator_class:
        mock_orchestrator = AsyncMock()
        mock_orchestrator.execute_goal = AsyncMock(return_value=mock_summary)
        mock_orchestrator_class.return_value = mock_orchestrator

        with patch("inf.server.app._create_model_router", new_callable=AsyncMock) as mock_router:
            mock_router.return_value = None

            response = client.post("/run", json={"goal": "failing goal"})

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert "run_id" in data
    assert data["completed"] == ["agent1"]
    assert data["failed"] == ["agent2", "agent3"]


def test_ask_endpoint_calls_provider() -> None:
    """Test /ask calls provider.chat and returns response."""
    mock_provider = AsyncMock()
    mock_provider.chat = AsyncMock(return_value="Test response from provider")
    
    with patch("inf.server.app.load_settings") as mock_load_settings:
        mock_settings = MagicMock()
        mock_settings.default_provider = "openai"
        mock_settings.default_model = "openai/gpt-4o-mini"
        mock_settings.api_keys = {"openai": "test-key"}
        mock_load_settings.return_value = mock_settings
        
        with patch("inf.server.app.get_provider", return_value=mock_provider):
            response = client.post("/ask", json={"prompt": "hello"})
    
    assert response.status_code == 200
    data = response.json()
    assert data["response"] == "Test response from provider"
    mock_provider.chat.assert_called_once()
    call_args = mock_provider.chat.call_args
    assert call_args.kwargs["model"] == "gpt-4o-mini"  # provider prefix stripped
    assert call_args.args[0] == [{"role": "user", "content": "hello"}]


def test_ask_endpoint_with_provider_override() -> None:
    """Test /ask respects provider and model from request."""
    mock_provider = AsyncMock()
    mock_provider.chat = AsyncMock(return_value="Custom provider response")
    
    with patch("inf.server.app.load_settings") as mock_load_settings:
        mock_settings = MagicMock()
        mock_settings.default_provider = "openai"
        mock_settings.default_model = "openai/gpt-4o-mini"
        mock_settings.api_keys = {"openai": "test-key", "anthropic": "anthropic-key"}
        mock_load_settings.return_value = mock_settings
        
        with patch("inf.server.app.get_provider", return_value=mock_provider):
            response = client.post(
                "/ask",
                json={"prompt": "hello", "provider": "anthropic", "model": "claude-3-haiku"},
            )
    
    assert response.status_code == 200
    data = response.json()
    assert data["response"] == "Custom provider response"
    mock_provider.chat.assert_called_once()
    call_args = mock_provider.chat.call_args
    assert call_args.kwargs["model"] == "claude-3-haiku"


def test_ask_endpoint_with_model_string_provider_prefix() -> None:
    """Test /ask handles provider/model format in model field."""
    mock_provider = AsyncMock()
    mock_provider.chat = AsyncMock(return_value="Model string response")
    
    with patch("inf.server.app.load_settings") as mock_load_settings:
        mock_settings = MagicMock()
        mock_settings.default_provider = "openai"
        mock_settings.default_model = "openai/gpt-4o-mini"
        mock_settings.api_keys = {"openai": "test-key", "google": "google-key"}
        mock_load_settings.return_value = mock_settings
        
        with patch("inf.server.app.get_provider", return_value=mock_provider):
            response = client.post(
                "/ask",
                json={"prompt": "hello", "model": "google/gemini-1.5-flash"},
            )
    
    assert response.status_code == 200
    data = response.json()
    assert data["response"] == "Model string response"
    mock_provider.chat.assert_called_once()
    call_args = mock_provider.chat.call_args
    assert call_args.kwargs["model"] == "gemini-1.5-flash"


def test_ask_endpoint_missing_api_key() -> None:
    """Test /ask returns 400 when API key is missing for provider."""
    with patch("inf.server.app.load_settings") as mock_load_settings:
        mock_settings = MagicMock()
        mock_settings.default_provider = "openai"
        mock_settings.default_model = "openai/gpt-4o-mini"
        mock_settings.api_keys = {}
        mock_load_settings.return_value = mock_settings
        
        response = client.post("/ask", json={"prompt": "hello"})
    
    assert response.status_code == 400
    data = response.json()
    assert "API key" in data["detail"]


def test_ask_endpoint_provider_error() -> None:
    """Test /ask returns 503 when provider raises an error."""
    mock_provider = AsyncMock()
    mock_provider.chat = AsyncMock(side_effect=Exception("Provider unavailable"))
    
    with patch("inf.server.app.load_settings") as mock_load_settings:
        mock_settings = MagicMock()
        mock_settings.default_provider = "openai"
        mock_settings.default_model = "openai/gpt-4o-mini"
        mock_settings.api_keys = {"openai": "test-key"}
        mock_load_settings.return_value = mock_settings
        
        with patch("inf.server.app.get_provider", return_value=mock_provider):
            response = client.post("/ask", json={"prompt": "hello"})
    
    assert response.status_code == 503
    data = response.json()
    assert "Provider error" in data["detail"]


def test_server_command_imports() -> None:
    from inf.cli.main import app as cli_app

    command_names = [cmd.name for cmd in cli_app.registered_commands]
    assert "server" in command_names