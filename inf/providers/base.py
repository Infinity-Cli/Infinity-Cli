"""Abstract base class for LLM providers."""

from abc import ABC, abstractmethod
from typing import Any, Optional


class Provider(ABC):
    """Abstract base for an LLM provider integration."""

    name: str = ""
    requires_api_key: bool = True

    @abstractmethod
    async def chat(
        self,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
        **kwargs: Any,
    ) -> str:
        """Send a chat request and return the assistant response text."""
        ...

    @abstractmethod
    async def validate(self, api_key: str) -> bool:
        """Validate that ``api_key`` is accepted by the provider."""
        ...
