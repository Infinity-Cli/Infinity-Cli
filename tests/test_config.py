"""Tests for Infinity CLI configuration."""

from inf.core.config import Settings, load_settings


def test_settings_defaults():
    settings = Settings()
    assert str(settings.infinity_home) == "."
    assert settings.database_url == "sqlite+aiosqlite:///infinity.db"
    assert settings.api_keys == {}
    assert settings.default_provider == "openai"
    assert settings.default_model == "openai/gpt-4o-mini"
    assert settings.log_level == "INFO"


def test_load_settings_returns_settings():
    settings = load_settings()
    assert isinstance(settings, Settings)
    assert settings.default_model == "openai/gpt-4o-mini"
    assert settings.default_provider == "openai"


def test_settings_loads_api_keys_from_env(monkeypatch):
    monkeypatch.setenv("INFINITY_API_KEY_OPENAI", "sk-openai-test")
    monkeypatch.setenv("INFINITY_API_KEY_ANTHROPIC", "sk-ant-test")
    settings = Settings()
    assert settings.api_keys == {
        "openai": "sk-openai-test",
        "anthropic": "sk-ant-test",
    }
