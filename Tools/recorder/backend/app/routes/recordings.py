from __future__ import annotations
import uuid
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from ..db import supabase
from ..config import get_settings
from ..services.transcribe import run_transcription

router = APIRouter(prefix="/recordings", tags=["recordings"])


class PasteIn(BaseModel):
    project_id: str
    transcript: str


@router.post("/upload")
async def upload_recording(
    background: BackgroundTasks,
    project_id: str = Form(...),
    source_type: str = Form("upload"),
    file: UploadFile = File(...),
):
    if source_type not in ("mic", "upload"):
        raise HTTPException(400, "source_type must be 'mic' or 'upload'")
    s = get_settings()
    sb = supabase()
    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "webm").lower()
    storage_path = f"{project_id}/{uuid.uuid4()}.{ext}"
    data = await file.read()
    sb.storage.from_(s.supabase_bucket).upload(
        storage_path,
        data,
        file_options={"content-type": file.content_type or "application/octet-stream"},
    )
    row = {
        "project_id": project_id,
        "source_type": source_type,
        "audio_storage_path": storage_path,
        "status": "pending",
    }
    rec = sb.table("recordings").insert(row).execute().data[0]
    background.add_task(run_transcription, rec["id"], storage_path)
    return rec


@router.post("/paste")
def paste_transcript(body: PasteIn):
    row = {
        "project_id": body.project_id,
        "source_type": "paste",
        "transcript": body.transcript,
        "status": "done",
    }
    return supabase().table("recordings").insert(row).execute().data[0]


@router.get("/{recording_id}")
def get_recording(recording_id: str):
    rec = supabase().table("recordings").select("*").eq("id", recording_id).single().execute().data
    if not rec:
        raise HTTPException(404, "Recording not found")
    return rec


@router.get("/{recording_id}/audio-url")
def get_audio_url(recording_id: str):
    s = get_settings()
    sb = supabase()
    rec = sb.table("recordings").select("audio_storage_path").eq("id", recording_id).single().execute().data
    if not rec or not rec.get("audio_storage_path"):
        raise HTTPException(404, "No audio for this recording")
    signed = sb.storage.from_(s.supabase_bucket).create_signed_url(rec["audio_storage_path"], 3600)
    return {"url": signed.get("signedURL") or signed.get("signed_url")}


@router.delete("/{recording_id}")
def delete_recording(recording_id: str):
    sb = supabase()
    rec = sb.table("recordings").select("audio_storage_path").eq("id", recording_id).single().execute().data
    if rec and rec.get("audio_storage_path"):
        try:
            sb.storage.from_(get_settings().supabase_bucket).remove([rec["audio_storage_path"]])
        except Exception:
            pass
    sb.table("recordings").delete().eq("id", recording_id).execute()
    return {"ok": True}
