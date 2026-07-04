"""Secret management with automatic API key detection and saving."""

import questionary
from pathlib import Path
from typing import Dict, Optional

# Mapping of known API key prefixes to environment variable names
KNOWN_KEYS: dict[str, str] = {
    "sk-": "OPENAI_API_KEY",
    "sk-ant-": "ANTHROPIC_API_KEY",
    "sk-live-": "STRIPE_API_KEY",  # example
    "eyJ": "JWT_TOKEN",  # JWT-like token
    # Add more as needed
}


def guess_provider(key: str) -> Optional[str]:
    """Return the likely env var name for a given API key based on its prefix."""
    for prefix, var_name in KNOWN_KEYS.items():
        if key.startswith(prefix):
            return var_name
    return None


class SecretManager:
    """Manage required secrets for execution with auto-detection and .env storage."""

    def __init__(self, env_path: Optional[Path] = None):
        self.env_path = env_path or Path(".env")
        self.secrets: Dict[str, str] = {}
        self._load_existing()

    def _load_existing(self) -> None:
        """Load existing secrets from .env file."""
        if self.env_path.exists():
            with self.env_path.open() as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        key, value = line.split("=", 1)
                        self.secrets[key] = value

    def _ensure_gitignore(self) -> None:
        """Ensure .env is listed in .gitignore."""
        gitignore = Path(".gitignore")
        if gitignore.exists():
            content = gitignore.read_text()
            if ".env" not in [ln.strip() for ln in content.splitlines()]:
                gitignore.write_text(content + "\n.env\n")
        else:
            gitignore.write_text(".env\n")

    def _save_secrets(self) -> None:
        """Write current secrets to .env file."""
        lines = [f"{k}={v}" for k, v in self.secrets.items()]
        self.env_path.write_text("\n".join(lines) + "\n")

    async def validate_or_prompt(self, required_keys: list[str]) -> Dict[str, str]:
        """
        Ensure all required keys are present.
        If missing, prompt the user, auto‑detect the provider, and store it.
        """
        missing = [k for k in required_keys if k not in self.secrets]
        if not missing:
            return self.secrets

        # Ask the user to paste a key (they may provide one key that covers several needs)
        # We'll ask once and then try to satisfy as many missing keys as possible.
        answer = await questionary.password(
            "Enter your API key (will be checked for known providers):"
        ).ask_async()
        if answer is None:
            # User cancelled
            return self.secrets

        guessed = guess_provider(answer.strip())
        if guessed:
            # Assign to the guessed variable; if multiple missing, fill them all with same value
            for k in missing:
                self.secrets[k] = answer.strip()
            # Also ensure the guessed variable exists
            self.secrets[guessed] = answer.strip()
        else:
            # Fallback: ask for each missing key individually
            for key in missing:
                val = await questionary.password(
                    f"Enter value for {key}:"
                ).ask_async()
                if val:
                    self.secrets[key] = val

        self._ensure_gitignore()
        self._save_secrets()
        return self.secrets

    def get(self, key: str) -> Optional[str]:
        """Retrieve a secret by name."""
        return self.secrets.get(key)

    def is_placeholder(self, key: str) -> bool:
        """Check if the stored value looks like a placeholder."""
        val = self.secrets.get(key, "")
        return val.startswith("PLACEHOLDER_")