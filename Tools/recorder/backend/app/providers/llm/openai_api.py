from __future__ import annotations
from .base import LLMProvider, LLMResult


class OpenAIProvider(LLMProvider):
    name = "openai_api"

    def complete(self, system: str, user: str) -> LLMResult:
        raise NotImplementedError(
            "openai_api LLM provider is not yet implemented. "
            "Wire it up in app/providers/llm/openai_api.py "
            "(use OPENAI_API_KEY + openai SDK)."
        )