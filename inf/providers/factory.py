"""Factory for creating provider instances from settings."""

from typing import Optional

from inf.core.config import Settings
from inf.providers.base import Provider
from inf.providers.registry import PROVIDER_REGISTRY


def get_provider(
    provider_id: str,
    api_key: Optional[str] = None,
    **kwargs: Optional[str],
) -> Provider:
    """Return a concrete provider instance for ``provider_id``.

    ``api_key`` is required for all built-in providers. ``base_url`` is
    required for the ``openai_compatible`` provider.
    """
    provider_cls = PROVIDER_REGISTRY.get(provider_id)
    if provider_cls is None:
        raise ValueError(f"Unknown provider: {provider_id}")

    if provider_id == "openai_compatible":
        base_url = kwargs.get("base_url")
        if not base_url:
            raise ValueError("openai_compatible provider requires base_url")
        return provider_cls(api_key=api_key, base_url=base_url)  # type: ignore[call-arg]
    if provider_id == "nvidia":
        return provider_cls(api_key=api_key)  # type: ignore[call-arg]
    return provider_cls(api_key=api_key)  # type: ignore[call-arg]


def resolve_provider(settings: Settings) -> tuple[str, str]:
    """Pick the first configured provider from ``settings.api_keys``.

    Returns a tuple of ``(provider_id, api_key)``. Falls back to the
    configured ``default_provider`` if no key is found.
    """
    if settings.api_keys:
        provider_id = next(iter(settings.api_keys))
        return provider_id, settings.api_keys[provider_id]

    provider_id = settings.default_provider
    return provider_id, ""
