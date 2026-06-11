from __future__ import annotations
from ..config import get_settings
from .transcription.base import TranscriptionProvider
from .llm.base import LLMProvider


def get_transcription_provider() -> TranscriptionProvider:
    name = get_settings().transcription_provider
    if name == "whisper_local":
        from .transcription.whisper_local import WhisperLocalProvider
        return WhisperLocalProvider()
    if name == "openai_api":
        from .transcription.openai_api import OpenAIWhisperProvider
        return OpenAIWhisperProvider()
    raise ValueError(f"Unknown transcription provider: {name}")


def get_llm_provider() -> LLMProvider:
    name = get_settings().llm_provider
    if name == "ollama_local":
        from .llm.ollama_local import OllamaLocalProvider
        return OllamaLocalProvider()
    if name == "anthropic_api":
        from .llm.anthropic_api import AnthropicProvider
        return AnthropicProvider()
    if name == "openai_api":
        from .llm.openai_api import OpenAIProvider
        return OpenAIProvider()
    raise ValueError(f"Unknown LLM provider: {name}")