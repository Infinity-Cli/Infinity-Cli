"""Abstract base class for pluggable model providers."""

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Dict, List


class ModelClient(ABC):
    """Async chat model client interface.

    Implementations must provide non-streaming chat, streaming chat, and a
    lightweight validation check against the provider endpoint.
    """

    def __init__(self, model_name: str, base_url: str, **kwargs: Any):
        self.model_name = model_name
        self.base_url = base_url.rstrip("/")

    @abstractmethod
    async def chat(self, messages: List[Dict[str, str]], stream: bool = False) -> str:
        """Send messages and return the full response string.

        Args:
            messages: List of message dicts with ``role`` and ``content`` keys.
            stream: If True, the implementation should consume its own stream
                and return the concatenated response.
        """
        raise NotImplementedError

    @abstractmethod
    async def stream(self, messages: List[Dict[str, str]]) -> AsyncIterator[str]:
        """Send messages and yield response content chunks as they arrive."""
        raise NotImplementedError

    @abstractmethod
    async def validate(self) -> bool:
        """Lightweight health/availability check for the model endpoint."""
        raise NotImplementedError
