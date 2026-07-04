"""Tests for LLM provider HTTP clients."""

import json

import httpx
import pytest

from inf.providers.factory import get_provider
from inf.providers.registry import (
    AnthropicProvider,
    GoogleProvider,
    OpenAICompatibleProvider,
    OpenAIProvider,
)


class FakeResponse:
    def __init__(self, status_code: int, json_data: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._json = json_data or {}
        self.text = text or json.dumps(json_data)

    def json(self):
        return self._json


class FakeAsyncClient:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []
        self.closed = False

    async def post(self, url: str, **kwargs) -> FakeResponse:
        kwargs.pop("timeout", None)
        req = httpx.Request("POST", url, **kwargs)
        self.requests.append(req)
        return self.responses.pop(0)

    async def get(self, url: str, **kwargs) -> FakeResponse:
        kwargs.pop("timeout", None)
        req = httpx.Request("GET", url, **kwargs)
        self.requests.append(req)
        return self.responses.pop(0)

    async def aclose(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_openai_provider_chat():
    response = FakeResponse(200, {
        "choices": [{"message": {"content": "Hello from OpenAI"}}]
    })
    client = FakeAsyncClient([response])
    provider = OpenAIProvider(api_key="sk-test", client=client)

    result = await provider.chat([{"role": "user", "content": "hi"}], model="openai/gpt-4o-mini")

    assert result == "Hello from OpenAI"
    assert client.requests[0].method == "POST"
    assert str(client.requests[0].url) == "https://api.openai.com/v1/chat/completions"
    body = json.loads(client.requests[0].content)
    assert body["model"] == "gpt-4o-mini"
    assert body["messages"] == [{"role": "user", "content": "hi"}]


@pytest.mark.asyncio
async def test_openai_provider_validate():
    response = FakeResponse(200, {"data": []})
    client = FakeAsyncClient([response])
    provider = OpenAIProvider(api_key="sk-test", client=client)

    valid = await provider.validate("sk-test")

    assert valid is True
    assert str(client.requests[0].url) == "https://api.openai.com/v1/models"
    assert "authorization" in {k.lower(): v for k, v in client.requests[0].headers.items()}


@pytest.mark.asyncio
async def test_openai_provider_chat_error():
    response = FakeResponse(401, text="unauthorized")
    client = FakeAsyncClient([response])
    provider = OpenAIProvider(api_key="sk-test", client=client)

    result = await provider.chat([{"role": "user", "content": "hi"}])

    assert "OpenAI API error 401" in result


@pytest.mark.asyncio
async def test_anthropic_provider_chat():
    response = FakeResponse(200, {
        "content": [{"type": "text", "text": "Hello from Claude"}]
    })
    client = FakeAsyncClient([response])
    provider = AnthropicProvider(api_key="sk-ant-test", client=client)

    result = await provider.chat(
        [{"role": "system", "content": "be nice"}, {"role": "user", "content": "hi"}],
        model="anthropic/claude-3-5-sonnet",
    )

    assert result == "Hello from Claude"
    body = json.loads(client.requests[0].content)
    assert body["model"] == "claude-3-5-sonnet"
    assert body["system"] == "be nice"


@pytest.mark.asyncio
async def test_anthropic_provider_validate():
    response = FakeResponse(400, text="bad request")
    client = FakeAsyncClient([response])
    provider = AnthropicProvider(api_key="sk-ant-test", client=client)

    valid = await provider.validate("sk-ant-test")

    assert valid is True


@pytest.mark.asyncio
async def test_google_provider_chat():
    response = FakeResponse(200, {
        "candidates": [{"content": {"parts": [{"text": "Hello from Gemini"}]}}]
    })
    client = FakeAsyncClient([response])
    provider = GoogleProvider(api_key="AIzaTest", client=client)

    result = await provider.chat([{"role": "user", "content": "hi"}], model="google/gemini-pro")

    assert result == "Hello from Gemini"
    assert ":generateContent" in str(client.requests[0].url)
    assert "key=AIzaTest" in str(client.requests[0].url)
    body = json.loads(client.requests[0].content)
    assert body["contents"][0]["parts"][0]["text"] == "hi"


@pytest.mark.asyncio
async def test_google_provider_validate():
    response = FakeResponse(200, {"models": []})
    client = FakeAsyncClient([response])
    provider = GoogleProvider(api_key="AIzaTest", client=client)

    valid = await provider.validate("AIzaTest")

    assert valid is True
    assert str(client.requests[0].url).startswith("https://generativelanguage.googleapis.com/v1beta/models")


@pytest.mark.asyncio
async def test_openai_compatible_provider_chat():
    response = FakeResponse(200, {
        "choices": [{"message": {"content": "Hello from local"}}]
    })
    client = FakeAsyncClient([response])
    provider = OpenAICompatibleProvider(
        api_key="local-key",
        base_url="http://localhost:1234/v1",
        client=client,
    )

    result = await provider.chat([{"role": "user", "content": "hi"}])

    assert result == "Hello from local"
    assert str(client.requests[0].url) == "http://localhost:1234/v1/chat/completions"


@pytest.mark.asyncio
async def test_openai_compatible_provider_validate():
    response = FakeResponse(200, {"data": []})
    client = FakeAsyncClient([response])
    provider = OpenAICompatibleProvider(
        api_key="local-key",
        base_url="http://localhost:1234/v1",
        client=client,
    )

    valid = await provider.validate("local-key")

    assert valid is True
    assert str(client.requests[0].url) == "http://localhost:1234/v1/models"


def test_get_provider_requires_base_url():
    with pytest.raises(ValueError, match="base_url"):
        get_provider("openai_compatible", api_key="x")
