from __future__ import annotations
import os
import tempfile
from ..db import supabase
from ..config import get_settings
from ..providers import get_transcription_provider


def run_transcription(recording_id: str, storage_path: str) -> None:
    """Download audio from Supabase Storage, transcribe, persist transcript."""
    sb = supabase()
    bucket = get_settings().supabase_bucket
    try:
        sb.table("recordings").update({"status": "transcribing"}).eq("id", recording_id).execute()

        blob = sb.storage.from_(bucket).download(storage_path)
        suffix = os.path.splitext(storage_path)[1] or ".bin"
        fd, tmp = tempfile.mkstemp(suffix=suffix)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(blob)
            result = get_transcription_provider().transcribe(tmp)
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass

        sb.table("recordings").update({
            "transcript": result.text,
            "duration_seconds": int(result.duration_seconds) if result.duration_seconds else None,
            "status": "done",
        }).eq("id", recording_id).execute()
    except Exception as e:
        sb.table("recordings").update({
            "status": "error",
            "error_message": str(e)[:1000],
        }).eq("id", recording_id).execute()
