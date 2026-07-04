"""Detect the LLM provider from an API key string."""


def detect_provider(api_key: str) -> str | None:
    """Infer the provider id from an API key prefix/format.

    Returns one of: ``openai``, ``anthropic``, ``google``, ``openai_compatible``,
    or ``None`` if the input is empty/whitespace.
    """
    if not api_key or not api_key.strip():
        return None

    key = api_key.strip()

    if key.startswith("sk-ant-"):
        return "anthropic"
    if key.startswith("AIza"):
        return "google"
    if key.startswith("nvapi-"):
        return "nvidia"
    if key.startswith("sk-") and len(key) > 40:
        return "openai"

    return "openai_compatible"
