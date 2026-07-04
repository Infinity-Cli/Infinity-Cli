"""Prompt helpers for secret input."""

from __future__ import annotations

import getpass
from pathlib import Path


def prompt_for_secret(prompt_text: str = "Enter API key") -> str | None:
    """Read a secret from the terminal without echoing input.

    Args:
        prompt_text: Prompt displayed to the user.

    Returns:
        The typed secret, or ``None`` if the input is empty.
    """
    value = getpass.getpass(prompt=prompt_text)
    stripped = value.strip()
    return stripped if stripped else None


def confirm_overwrite(path: Path) -> bool:
    """Confirm overwriting ``path``.

    Returns:
        ``True`` if the file does not exist or if the user confirms overwrite.
    """
    if not Path(path).exists():
        return True
    answer = input(f"{path} already exists. Overwrite? [y/N]: ")
    return answer.strip().lower() in {"y", "yes"}
