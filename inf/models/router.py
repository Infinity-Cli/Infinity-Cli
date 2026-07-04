"""Model router: selects and delegates to registered model providers."""

from typing import Dict, Optional

from ..core.config import DEFAULT_MODEL, OLLAMA_BASE_URL
from .base import ModelClient
from .ollama import OllamaClient


class ModelRouter:
    """Registry and dispatcher for model provider clients.

    The router is initialized with a default Ollama client and allows
    additional providers to be registered at runtime.
    """

    def __init__(
        self,
        default_model: Optional[str] = None,
        base_url: Optional[str] = None,
    ):
        self.default_model = default_model or DEFAULT_MODEL
        self.base_url = base_url or OLLAMA_BASE_URL
        self._registry: Dict[str, ModelClient] = {}

        # Register the default local Ollama provider
        self.register(
            "ollama",
            OllamaClient(model_name=self.default_model, base_url=self.base_url),
        )

    def register(self, name: str, client: ModelClient) -> None:
        """Register a model provider by name."""
        self._registry[name] = client

    def get_model(self, name: Optional[str] = None) -> ModelClient:
        """Resolve a provider by name; defaults to ``ollama``."""
        provider = name or "ollama"
        if provider not in self._registry:
            raise ValueError(f"Unknown model provider: {provider}")
        return self._registry[provider]

    def resolve_model(self, name: Optional[str] = None) -> ModelClient:
        """Alias for :meth:`get_model`."""
        return self.get_model(name)

    async def chat(
        self,
        messages: list,
        stream: bool = False,
        provider: Optional[str] = None,
    ) -> str:
        """Delegate a chat request to the active provider."""
        model = self.get_model(provider)
        return await model.chat(messages, stream=stream)

    async def stream(self, messages: list, provider: Optional[str] = None):
        """Delegate a streaming chat request to the active provider."""
        model = self.get_model(provider)
        async for chunk in model.stream(messages):  # type: ignore[attr-defined]
            yield chunk

    def __contains__(self, name: str) -> bool:
        return name in self._registry
