from __future__ import annotations
from .base import TranscriptionProvider, TranscriptResult


class OpenAIWhisperProvider(TranscriptionProvider):
    name = "openai_api"

    def transcribe(self, audio_path: str) -> TranscriptResult:
        raise NotImplementedError(
            "openai_api transcription provider is not yet implemented. "
            "Wire it up in app/providers/transcription/openai_api.py "
            "(use OPENAI_API_KEY from settings)."
        )