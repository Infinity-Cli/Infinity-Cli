"""Secret management with .env handling and secure storage"""

from pathlib import Path
from typing import List, Optional, Dict
import os

import questionary


class SecretManager:
    """Manage required secrets for execution"""

    def __init__(self, env_path: Optional[Path] = None):
        self.env_path = env_path or Path(".env")
        self.secrets: Dict[str, str] = {}
        self._load_existing()

    def _load_existing(self):
        """Load existing secrets from .env file"""
        if self.env_path.exists():
            with open(self.env_path) as f:
                for line in f:
                    if "=" in line and not line.startswith("#"):
                        key, value = line.strip().split("=", 1)
                        self.secrets[key] = value

    def _ensure_gitignore(self):
        """Ensure .env is in .gitignore"""
        gitignore = Path(".gitignore")
        if gitignore.exists():
            content = gitignore.read_text()
            if ".env" not in content:
                gitignore.write_text(content + "\n.env\n")
        else:
            gitignore.write_text(".env\n")

    async def validate_or_prompt(self, required_secrets: List[str]) -> Dict[str, str]:
        """Validate or prompt for required secrets"""
        missing = [s for s in required_secrets if s not in self.secrets]

        if missing:
            if not required_secrets:
                return self.secrets

            if not await self._prompt_secrets(missing):
                return self.secrets

        self._ensure_gitignore()
        return self.secrets

    async def _prompt_secrets(self, missing: List[str]) -> bool:
        """Ask user for missing secrets interactively"""
        console = await _get_console()
        console.print(f"[yellow]Missing secrets required: {missing}[/yellow]")

        for secret in missing:
            value = await questionary.password(f"Enter {secret}:").ask_async()
            if value:
                self.secrets[secret] = value
            else:
                self.secrets[secret] = f"PLACEHOLDER_{secret}"

        self._save_secrets()
        return True

    def _save_secrets(self):
        """Save secrets to .env file"""
        lines = []
        for key, value in self.secrets.items():
            lines.append(f"{key}={value}")

        self.env_path.write_text("\n".join(lines) + "\n")

    def get(self, key: str) -> Optional[str]:
        """Get a secret value"""
        return self.secrets.get(key)

    def is_placeholder(self, key: str) -> bool:
        """Check if secret is a placeholder (needs real value)"""
        value = self.secrets.get(key, "")
        return value.startswith("PLACEHOLDER_")


async def _get_console():
    from rich.console import Console
    return Console()