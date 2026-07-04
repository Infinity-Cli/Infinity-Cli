"""Pluggable model provider interface for Infinity CLI."""

from .base import ModelClient
from .ollama import OllamaClient
from .router import ModelRouter

__all__ = ["ModelClient", "OllamaClient", "ModelRouter"]
