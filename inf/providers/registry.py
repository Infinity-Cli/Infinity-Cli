"""Provider registry and real HTTP provider implementations."""

from typing import Any, Optional

import httpx

from inf.providers.base import Provider


def _pop_model(model: Optional[str], default: str) -> str:
    """Return a clean model name, stripping any provider namespace."""
    model = (model or default).strip()
    if "/" in model:
        _, _, model = model.partition("/")
    return model or default


class OpenAIProvider(Provider):
    name = "openai"
    requires_api_key = True
    default_model = "gpt-4o-mini"

    def __init__(self, api_key: str, client: Optional[httpx.AsyncClient] = None) -> None:
        self.api_key = api_key
        self.client = client

    async def chat(
        self,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
        **kwargs: Any,
    ) -> str:
        model_name = _pop_model(model, self.default_model)
        payload: dict[str, Any] = {
            "model": model_name,
            "messages": messages,
        }
        temperature = kwargs.get("temperature")
        if temperature is not None:
            payload["temperature"] = temperature
        max_tokens = kwargs.get("max_tokens")
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        async def _request(c: httpx.AsyncClient) -> str:
            response = await c.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=60,
            )
            return await _extract_openai_text(response)

        if self.client is not None:
            return await _request(self.client)
        async with httpx.AsyncClient() as c:
            return await _request(c)

    async def validate(self, api_key: str) -> bool:
        headers = {"Authorization": f"Bearer {api_key}"}

        async def _request(c: httpx.AsyncClient) -> bool:
            response = await c.get(
                "https://api.openai.com/v1/models",
                headers=headers,
                timeout=30,
            )
            return response.status_code == 200

        if self.client is not None:
            return await _request(self.client)
        async with httpx.AsyncClient() as c:
            return await _request(c)


async def _extract_openai_text(response: httpx.Response) -> str:
    if response.status_code >= 400:
        return f"OpenAI API error {response.status_code}: {response.text}"
    try:
        data = response.json()
    except Exception as exc:  # pragma: no cover
        return f"OpenAI API returned invalid JSON: {exc}"
    try:
        return data["choices"][0]["message"]["content"]
    except Exception as exc:  # pragma: no cover
        return f"OpenAI API unexpected response shape: {exc}"


class AnthropicProvider(Provider):
    name = "anthropic"
    requires_api_key = True
    default_model = "claude-3-5-sonnet-20241022"

    def __init__(self, api_key: str, client: Optional[httpx.AsyncClient] = None) -> None:
        self.api_key = api_key
        self.client = client

    async def chat(
        self,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
        **kwargs: Any,
    ) -> str:
        model_name = _pop_model(model, self.default_model)
        system_message: Optional[str] = None
        chat_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_message = msg.get("content", "")
            else:
                chat_messages.append(msg)

        payload: dict[str, Any] = {
            "model": model_name,
            "messages": chat_messages,
            "max_tokens": kwargs.get("max_tokens", 1024),
        }
        if system_message:
            payload["system"] = system_message

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

        async def _request(c: httpx.AsyncClient) -> str:
            response = await c.post(
                "https://api.anthropic.com/v1/messages",
                headers=headers,
                json=payload,
                timeout=60,
            )
            return await _extract_anthropic_text(response)

        if self.client is not None:
            return await _request(self.client)
        async with httpx.AsyncClient() as c:
            return await _request(c)

    async def validate(self, api_key: str) -> bool:
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.default_model,
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 1,
        }

        async def _request(c: httpx.AsyncClient) -> bool:
            response = await c.post(
                "https://api.anthropic.com/v1/messages",
                headers=headers,
                json=payload,
                timeout=30,
            )
            return response.status_code in (200, 400)

        if self.client is not None:
            return await _request(self.client)
        async with httpx.AsyncClient() as c:
            return await _request(c)


async def _extract_anthropic_text(response: httpx.Response) -> str:
    if response.status_code >= 400:
        return f"Anthropic API error {response.status_code}: {response.text}"
    try:
        data = response.json()
    except Exception as exc:  # pragma: no cover
        return f"Anthropic API returned invalid JSON: {exc}"
    try:
        content = data["content"]
        if isinstance(content, list):
            return "".join(block.get("text", "") for block in content if block.get("type") == "text")
        return str(content)
    except Exception as exc:  # pragma: no cover
        return f"Anthropic API unexpected response shape: {exc}"


class GoogleProvider(Provider):
    name = "google"
    requires_api_key = True
    default_model = "gemini-1.5-flash"

    def __init__(self, api_key: str, client: Optional[httpx.AsyncClient] = None) -> None:
        self.api_key = api_key
        self.client = client

    async def chat(
        self,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
        **kwargs: Any,
    ) -> str:
        model_name = _pop_model(model, self.default_model)
        contents = []
        for msg in messages:
            role = "user" if msg.get("role") in ("user", "system") else msg.get("role", "user")
            contents.append({"role": role, "parts": [{"text": msg.get("content", "")}]})

        payload = {"contents": contents}
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:generateContent?key={self.api_key}"
        )

        async def _request(c: httpx.AsyncClient) -> str:
            response = await c.post(
                url,
                json=payload,
                timeout=60,
            )
            return await _extract_google_text(response)

        if self.client is not None:
            return await _request(self.client)
        async with httpx.AsyncClient() as c:
            return await _request(c)

    async def validate(self, api_key: str) -> bool:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models"
            f"?key={api_key}"
        )

        async def _request(c: httpx.AsyncClient) -> bool:
            response = await c.get(url, timeout=30)
            return response.status_code == 200

        if self.client is not None:
            return await _request(self.client)
        async with httpx.AsyncClient() as c:
            return await _request(c)


async def _extract_google_text(response: httpx.Response) -> str:
    if response.status_code >= 400:
        return f"Google API error {response.status_code}: {response.text}"
    try:
        data = response.json()
    except Exception as exc:  # pragma: no cover
        return f"Google API returned invalid JSON: {exc}"
    try:
        candidates = data["candidates"]
        if candidates and "content" in candidates[0]:
            parts = candidates[0]["content"].get("parts", [])
            return "".join(part.get("text", "") for part in parts)
        return ""
    except Exception as exc:  # pragma: no cover
        return f"Google API unexpected response shape: {exc}"


class OpenAICompatibleProvider(Provider):
    name = "openai_compatible"
    requires_api_key = True
    default_model = "gpt-4o-mini"

    def __init__(
        self,
        api_key: str,
        base_url: str,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.client = client

    async def chat(
        self,
        messages: list[dict[str, str]],
        model: Optional[str] = None,
        **kwargs: Any,
    ) -> str:
        model_name = _pop_model(model, self.default_model)
        payload: dict[str, Any] = {
            "model": model_name,
            "messages": messages,
        }
        temperature = kwargs.get("temperature")
        if temperature is not None:
            payload["temperature"] = temperature
        max_tokens = kwargs.get("max_tokens")
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        async def _request(c: httpx.AsyncClient) -> str:
            response = await c.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
                timeout=60,
            )
            return await _extract_openai_text(response)

        if self.client is not None:
            return await _request(self.client)
        async with httpx.AsyncClient() as c:
            return await _request(c)

    async def validate(self, api_key: str) -> bool:
        headers = {"Authorization": f"Bearer {api_key}"}

        async def _request(c: httpx.AsyncClient) -> bool:
            response = await c.get(
                f"{self.base_url}/models",
                headers=headers,
                timeout=30,
            )
            return response.status_code == 200

        if self.client is not None:
            return await _request(self.client)
        async with httpx.AsyncClient() as c:
            return await _request(c)


class NvidiaProvider(OpenAICompatibleProvider):
    """NVIDIA API-compatible provider using the OpenAI-compatible endpoint."""

    name = "nvidia"
    requires_api_key = True
    default_model = "meta/llama-3.1-8b-instruct"

    def __init__(self, api_key: str, client: Optional[httpx.AsyncClient] = None) -> None:
        super().__init__(api_key=api_key, base_url="https://integrate.api.nvidia.com/v1", client=client)


PROVIDER_REGISTRY: dict[str, type[Provider]] = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "google": GoogleProvider,
    "nvidia": NvidiaProvider,
    "openai_compatible": OpenAICompatibleProvider,
}
