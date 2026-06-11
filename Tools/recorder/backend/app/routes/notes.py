from __future__ import annotations
from fastapi import APIRouter
from pydantic import BaseModel
from ..db import supabase

router = APIRouter(prefix="/notes", tags=["notes"])


class NoteIn(BaseModel):
    project_id: str
    content: str


@router.post("")
def create_note(body: NoteIn):
    row = {"project_id": body.project_id, "content": body.content}
    return supabase().table("notes").insert(row).execute().data[0]


@router.get("")
def list_notes(project_id: str):
    return (
        supabase()
        .table("notes")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )


@router.delete("/{note_id}")
def delete_note(note_id: str):
    supabase().table("notes").delete().eq("id", note_id).execute()
    return {"ok": True}