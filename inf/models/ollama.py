"""Ollama chat model client implementing the ModelClient interface."""

import json
from typing import Any, AsyncIterator, Dict, List

import httpx

from .base import ModelClient


class OllamaClient(ModelClient):
    """Async client for the Ollama ``/api/chat`` endpoint.

    Supports both full-response chat and streaming response chunks. An
    ``httpx.AsyncClient`` may be injected via the ``client`` keyword for
    testing or connection reuse.
    """

    def __init__(self, model_name: str, base_url: str, **kwargs: Any):
        super().__init__(model_name=model_name, base_url=base_url, **kwargs)
        self._client: httpx.AsyncClient = kwargs.get("client") or httpx.AsyncClient(
            base_url=self.base_url
        )

    async def chat(self, messages: List[Dict[str, str]], stream: bool = False) -> str:
        """Call Ollama chat and return the assistant's full content."""
        if stream:
            chunks: List[str] = []
            async for chunk in self.stream(messages):
                chunks.append(chunk)
            return "".join(chunks)

        payload = {
            "model": self.model_name,
            "messages": messages,
            "stream": False,
        }
        response = await self._client.post("/api/chat", json=payload)
        response.raise_for_status()
        data = response.json()
        return data.get("message", {}).get("content", "")

    async def stream(self, messages: List[Dict[str, str]]) -> AsyncIterator[str]:  # type: ignore[override]
        """Call Ollama chat with streaming enabled and yield content chunks."""
        payload = {
            "model": self.model_name,
            "messages": messages,
            "stream": True,
        }
        async with self._client.stream("POST", "/api/chat", json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    data: Dict[str, Any] = json.loads(line)
                except json.JSONDecodeError:
                    continue
                message = data.get("message", {}) or {}
                content = message.get("content", "")
                if content:
                    yield content

    async def validate(self) -> bool:
        """Check Ollama availability and verify the configured model exists.

        Uses the lightweight ``/api/tags`` endpoint to list locally available
        models without loading the model into memory.
        """
        try:
            response = await self._client.get("/api/tags")
            response.raise_for_status()
            data = response.json()
            models = data.get("models", [])
            names = {m.get("name") for m in models if isinstance(m, dict)}
            return self.model_name in names
        except Exception:
            return False
