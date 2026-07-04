"""Tests for the provider detector."""

import pytest

from inf.providers.detector import detect_provider


def test_detect_openai_key():
    key = "sk-" + "a" * 45
    assert detect_provider(key) == "openai"


def test_detect_anthropic_key():
    key = "sk-ant-api03-test-key"
    assert detect_provider(key) == "anthropic"


def test_detect_google_key():
    key = "AIzaSyA-test-key"
    assert detect_provider(key) == "google"


def test_detect_openai_compatible_fallback():
    key = "some-random-key"
    assert detect_provider(key) == "openai_compatible"


def test_detect_empty_key():
    assert detect_provider("") is None
    assert detect_provider("   ") is None


def test_detect_openai_key_too_short():
    key = "sk-short"
    assert detect_provider(key) == "openai_compatible"


@pytest.mark.parametrize(
    "key, expected",
    [
        ("sk-ant-123", "anthropic"),
        ("AIza0000000000", "google"),
        ("sk-" + "x" * 50, "openai"),
        ("mystery", "openai_compatible"),
    ],
)
def test_detect_provider_parametrized(key, expected):
    assert detect_provider(key) == expected
