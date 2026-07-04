"""Tests for the Infinity CLI pluggable model provider layer."""

from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
import pytest

from inf.models.base import ModelClient
from inf.models.ollama import OllamaClient
from inf.models.router import ModelRouter


class FakeResponse:
    """Mock httpx.Response for non-streaming requests."""

    def __init__(
        self,
        status_code: int = 200,
        json_data: Optional[Dict[str, Any]] = None,
        lines: Optional[List[str]] = None,
    ):
        self.status_code = status_code
        self._json = json_data or {}
        self._lines = lines or []

    def json(self) -> Dict[str, Any]:
        return self._json

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "Request failed",
                request=httpx.Request("GET", "http://localhost"),
                response=self,
            )

    async def aiter_lines(self) -> AsyncIterator[str]:
        for line in self._lines:
            yield line


class FakeStreamContext:
    """Async context manager returned by FakeAsyncClient.stream."""

    def __init__(self, response: FakeResponse):
        self.response = response

    async def __aenter__(self) -> FakeResponse:
        return self.response

    async def __aexit__(self, exc_type, exc, tb) -> None:
        pass


class FakeAsyncClient:
    """Injectable fake httpx.AsyncClient for model tests."""

    def __init__(
        self,
        response: Optional[FakeResponse] = None,
        stream_response: Optional[FakeResponse] = None,
    ):
        self.response = response
        self.stream_response = stream_response

    async def post(self, *args: Any, **kwargs: Any) -> FakeResponse:
        return self.response

    async def get(self, *args: Any, **kwargs: Any) -> FakeResponse:
        return self.response

    def stream(self, *args: Any, **kwargs: Any) -> FakeStreamContext:
        return FakeStreamContext(self.stream_response)


@pytest.mark.asyncio
async def test_model_client_is_abstract():
    """The base ModelClient cannot be instantiated directly."""
    with pytest.raises(TypeError):
        ModelClient(model_name="test", base_url="http://localhost")


@pytest.mark.asyncio
async def test_ollama_chat_non_stream():
    """OllamaClient.chat returns the assistant content from a mocked response."""
    fake_response = FakeResponse(
        200, json_data={"message": {"role": "assistant", "content": "Hello!"}}
    )
    fake_client = FakeAsyncClient(response=fake_response)
    client = OllamaClient(
        model_name="qwen2.5-coder:7b",
        base_url="http://localhost:11434",
        client=fake_client,
    )

    result = await client.chat([{"role": "user", "content": "hi"}])

    assert result == "Hello!"


@pytest.mark.asyncio
async def test_ollama_stream_yields_chunks():
    """OllamaClient.stream yields content chunks from streamed NDJSON lines."""
    stream_response = FakeResponse(
        200,
        lines=[
            '{"message": {"role": "assistant", "content": "Hello"}}',
            '{"message": {"role": "assistant", "content": " world"}}',
            '{"done": true}',
        ],
    )
    fake_client = FakeAsyncClient(stream_response=stream_response)
    client = OllamaClient(
        model_name="qwen2.5-coder:7b",
        base_url="http://localhost:11434",
        client=fake_client,
    )

    chunks = [chunk async for chunk in client.stream([{"role": "user", "content": "hi"}])]

    assert chunks == ["Hello", " world"]


@pytest.mark.asyncio
async def test_ollama_chat_stream_true_collects_chunks():
    """OllamaClient.chat with stream=True aggregates stream chunks."""
    stream_response = FakeResponse(
        200,
        lines=[
            '{"message": {"content": "Hi"}}',
            '{"message": {"content": " there"}}',
        ],
    )
    fake_client = FakeAsyncClient(stream_response=stream_response)
    client = OllamaClient(
        model_name="qwen2.5-coder:7b",
        base_url="http://localhost:11434",
        client=fake_client,
    )

    result = await client.chat([{"role": "user", "content": "hi"}], stream=True)

    assert result == "Hi there"


@pytest.mark.asyncio
async def test_ollama_validate_finds_model():
    """validate() uses /api/tags to confirm the configured model exists."""
    fake_response = FakeResponse(
        200,
        json_data={
            "models": [
                {"name": "qwen2.5-coder:7b"},
                {"name": "llama3:latest"},
            ]
        },
    )
    fake_client = FakeAsyncClient(response=fake_response)
    client = OllamaClient(
        model_name="qwen2.5-coder:7b",
        base_url="http://localhost:11434",
        client=fake_client,
    )

    assert await client.validate() is True


@pytest.mark.asyncio
async def test_ollama_validate_missing_model():
    """validate() returns False when the configured model is not listed."""
    fake_response = FakeResponse(
        200,
        json_data={"models": [{"name": "llama3:latest"}]},
    )
    fake_client = FakeAsyncClient(response=fake_response)
    client = OllamaClient(
        model_name="qwen2.5-coder:7b",
        base_url="http://localhost:11434",
        client=fake_client,
    )

    assert await client.validate() is False


@pytest.mark.asyncio
async def test_ollama_validate_endpoint_error():
    """validate() returns False when the Ollama endpoint errors."""
    fake_response = FakeResponse(500, json_data={})
    fake_client = FakeAsyncClient(response=fake_response)
    client = OllamaClient(
        model_name="qwen2.5-coder:7b",
        base_url="http://localhost:11434",
        client=fake_client,
    )

    assert await client.validate() is False


def test_router_resolves_default_ollama_model():
    """ModelRouter registers and resolves the default Ollama provider."""
    router = ModelRouter()

    model = router.get_model()

    assert isinstance(model, OllamaClient)
    assert model.model_name == "qwen2.5-coder:7b"
    assert model.base_url == "http://localhost:11434"


def test_router_resolve_model_alias():
    """resolve_model is an alias for get_model."""
    router = ModelRouter()

    assert router.resolve_model() is router.get_model()


def test_router_raises_for_unknown_model():
    """Requesting an unregistered provider raises a clear ValueError."""
    router = ModelRouter()

    with pytest.raises(ValueError, match="Unknown model provider: unknown"):
        router.get_model("unknown")


@pytest.mark.asyncio
async def test_router_delegates_chat():
    """ModelRouter.chat delegates to the active provider and returns content."""
    fake_response = FakeResponse(
        200, json_data={"message": {"content": "Router result"}}
    )
    fake_client = FakeAsyncClient(response=fake_response)
    router = ModelRouter()
    router.register(
        "ollama",
        OllamaClient(
            model_name="qwen2.5-coder:7b",
            base_url="http://localhost:11434",
            client=fake_client,
        ),
    )

    result = await router.chat([{"role": "user", "content": "hi"}])

    assert result == "Router result"


@pytest.mark.asyncio
async def test_router_delegates_stream():
    """ModelRouter.stream delegates to the active provider and yields chunks."""
    stream_response = FakeResponse(
        200,
        lines=[
            '{"message": {"content": "chunk1"}}',
            '{"message": {"content": "chunk2"}}',
        ],
    )
    fake_client = FakeAsyncClient(stream_response=stream_response)
    router = ModelRouter()
    router.register(
        "ollama",
        OllamaClient(
            model_name="qwen2.5-coder:7b",
            base_url="http://localhost:11434",
            client=fake_client,
        ),
    )

    chunks = [chunk async for chunk in router.stream([{"role": "user", "content": "hi"}])]

    assert chunks == ["chunk1", "chunk2"]


@pytest.mark.asyncio
async def test_router_allows_additional_provider_registration():
    """Additional providers can be registered and resolved by name."""

    class DummyProvider(ModelClient):
        async def chat(self, messages, stream=False):
            return "dummy"

        async def stream(self, messages):
            yield "dummy"

        async def validate(self):
            return True

    router = ModelRouter()
    router.register("dummy", DummyProvider(model_name="dummy", base_url="http://dummy"))

    model = router.get_model("dummy")
    assert isinstance(model, DummyProvider)
    assert await model.chat([]) == "dummy"
