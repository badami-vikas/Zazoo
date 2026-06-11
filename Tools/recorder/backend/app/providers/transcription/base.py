from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class TranscriptResult:
    text: str
    duration_seconds: float | None = None
    language: str | None = None


class TranscriptionProvider(ABC):
    name: str = "base"

    @abstractmethod
    def transcribe(self, audio_path: str) -> TranscriptResult: ...