"""API key management and .env persistence."""

import asyncio
import os
from pathlib import Path
from typing import Optional

import questionary
from dotenv import load_dotenv, set_key

from inf.providers.detector import detect_provider
from inf.providers.factory import get_provider


class ApiKeyManager:
    """Prompt, validate, detect, and persist API keys to ``.env``."""

    ENV_FILE = ".env"
    GITIGNORE = ".gitignore"
    KEY_PREFIX = "INFINITY_API_KEY_"

    def __init__(self, env_file: Optional[Path] = None) -> None:
        self.env_file = Path(env_file or self.ENV_FILE)

    @staticmethod
    def _looks_like_key(value: str) -> bool:
        """Return True if the value looks like a non-empty API key."""
        if not value:
            return False
        stripped = value.strip()
        return bool(stripped) and " " not in stripped

    def prompt_and_store(self) -> Optional[str]:
        """Prompt for an API key, detect provider, validate, and store in ``.env``."""
        raw_key = questionary.text(
            "Enter your LLM API key:",
            instruction="Paste your key (input will be shown)",
        ).ask()

        if raw_key is None:
            print("API key configuration cancelled.")
            return None

        key = raw_key.strip()
        if not self._looks_like_key(key):
            print("Invalid API key: key must be non-empty and contain no spaces.")
            return None

        provider = detect_provider(key)
        if provider is None:
            print("Could not detect provider from key.")
            return None

        env_var = f"{self.KEY_PREFIX}{provider.upper()}"
        self._ensure_env_file()
        self._ensure_gitignore_has_env()
        set_key(self.env_file, env_var, key)
        print(f"API key for provider '{provider}' stored as {env_var} in {self.env_file}")

        valid = self._validate_key(provider, key)
        if valid:
            print(f"[green]API key validated successfully for {provider}.[/green]")
        else:
            print(f"[yellow]Warning: API key validation failed for {provider}. The key was stored, but may need editing.[/yellow]")
        return env_var

    def _validate_key(self, provider_id: str, api_key: str) -> bool:
        """Run a lightweight async validation call against the provider."""
        try:
            provider = get_provider(provider_id, api_key=api_key)
            return asyncio.run(provider.validate(api_key))
        except Exception as exc:  # pragma: no cover
            print(f"[yellow]Validation check raised an error: {exc}[/yellow]")
            return False

    def load_keys(self) -> dict[str, str]:
        """Load all Infinity API keys from ``.env``."""
        load_dotenv(self.env_file)
        keys: dict[str, str] = {}
        for provider in ("openai", "anthropic", "google", "openai_compatible"):
            env_var = f"{self.KEY_PREFIX}{provider.upper()}"
            value = os.getenv(env_var)
            if value:
                keys[provider] = value
        return keys

    def has_any_key(self) -> bool:
        """Return True if at least one Infinity API key is configured."""
        return bool(self.load_keys())

    def _ensure_env_file(self) -> None:
        """Create the ``.env`` file if it does not exist."""
        if not self.env_file.exists():
            self.env_file.touch()
            self.env_file.write_text("# Infinity CLI environment variables\n", encoding="utf-8")

    def _ensure_gitignore_has_env(self) -> None:
        """Ensure ``.env`` is listed in ``.gitignore``."""
        gitignore = Path(self.GITIGNORE)
        if not gitignore.exists():
            gitignore.write_text(".env\n", encoding="utf-8")
            return
        content = gitignore.read_text(encoding="utf-8")
        lines = {line.strip() for line in content.splitlines()}
        if ".env" not in lines:
            with gitignore.open("a", encoding="utf-8") as f:
                if not content.endswith("\n"):
                    f.write("\n")
                f.write(".env\n")
