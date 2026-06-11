from __future__ import annotations
from functools import lru_cache
from faster_whisper import WhisperModel
from ...config import get_settings
from .base import TranscriptionProvider, TranscriptResult


@lru_cache(maxsize=1)
def _model() -> WhisperModel:
    s = get_settings()
    device = s.whisper_device
    if device == "auto":
        try:
            import torch  # type: ignore
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            device = "cpu"
    compute_type = s.whisper_compute_type
    if device == "cpu" and compute_type == "float16":
        compute_type = "int8"
    return WhisperModel(s.whisper_model, device=device, compute_type=compute_type)


class WhisperLocalProvider(TranscriptionProvider):
    name = "whisper_local"

    def transcribe(self, audio_path: str) -> TranscriptResult:
        # faster-whisper decodes via PyAV (bundled), so no system ffmpeg is required.
        # It accepts webm/m4a/mp3/wav directly.
        segments, info = _model().transcribe(audio_path, beam_size=1, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return TranscriptResult(
            text=text,
            duration_seconds=float(info.duration) if info.duration else None,
            language=info.language,
        )
