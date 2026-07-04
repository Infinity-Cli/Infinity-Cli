"""Pydantic-Settings based application configuration."""

import os
from pathlib import Path

from dotenv import load_dotenv
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
        for provider in ("openai", "anthropic", "google", "nvidia", "openai_compatible"):
            env_var = f"INFINITY_API_KEY_{provider.upper()}"
            value = os.getenv(env_var)
            if value:
                keys[provider] = value
        if keys:
            self.api_keys = keys
            # If the default provider has no configured key, pick the first one
            # and update the default model so simple commands work out of the box.
            if self.default_provider not in keys:
                first = next(iter(keys))
                self.default_provider = first
                if "/" in self.default_model and not self.default_model.startswith(f"{first}/"):
                    self.default_model = {
                        "nvidia": "nvidia/meta/llama-3.1-405b-instruct",
                    }.get(first, self.default_model.split("/", 1)[1])


def load_settings() -> Settings:
    """Load and return application settings."""
    if not os.getenv("PYTEST_CURRENT_TEST"):
        load_dotenv(".env")
    return Settings()
