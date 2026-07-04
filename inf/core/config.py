"""Pydantic-Settings based application configuration."""

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_MODEL: str = os.getenv("INFINITY_DEFAULT_MODEL", "qwen2.5-coder:7b")
OLLAMA_BASE_URL: str = os.getenv("INFINITY_OLLAMA_BASE_URL", "http://localhost:11434")


class Settings(BaseSettings):
    """Application settings loaded from environment and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    infinity_home: Path = Field(default=Path("."))
    database_url: str = Field(default="sqlite+aiosqlite:///infinity.db")
    api_keys: dict[str, str] = Field(default_factory=dict)
    default_provider: str = Field(default="openai")
    default_model: str = Field(default="openai/gpt-4o-mini")
    log_level: str = Field(default="INFO")


    def model_post_init(self, __context: object) -> None:
        """Load INFINITY_API_KEY_* variables from the environment."""
        keys: dict[str, str] = {}
        for provider in ("openai", "anthropic", "google", "openai_compatible"):
            env_var = f"INFINITY_API_KEY_{provider.upper()}"
            value = os.getenv(env_var)
            if value:
                keys[provider] = value
        if keys:
            self.api_keys = keys


def load_settings() -> Settings:
    """Load and return application settings."""
    return Settings()
