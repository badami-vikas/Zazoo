from __future__ import annotations
from .base import LLMProvider, LLMResult


class AnthropicProvider(LLMProvider):
    name = "anthropic_api"

    def complete(self, system: str, user: str) -> LLMResult:
        raise NotImplementedError(
            "anthropic_api LLM provider is not yet implemented. "
            "Wire it up in app/providers/llm/anthropic_api.py "
            "(use ANTHROPIC_API_KEY + anthropic SDK; default model claude-sonnet-4-6)."
        )