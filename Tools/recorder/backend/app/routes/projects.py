from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..db import supabase

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectIn(BaseModel):
    name: str
    description: str | None = ""


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


@router.get("")
def list_projects():
    return supabase().table("projects").select("*").order("created_at", desc=True).execute().data


@router.post("")
def create_project(body: ProjectIn):
    row = {"name": body.name, "description": body.description or ""}
    res = supabase().table("projects").insert(row).execute()
    return res.data[0]


@router.get("/{project_id}")
def get_project(project_id: str):
    sb = supabase()
    proj = sb.table("projects").select("*").eq("id", project_id).single().execute().data
    if not proj:
        raise HTTPException(404, "Project not found")
    recs = sb.table("recordings").select("*").eq("project_id", project_id).order("created_at", desc=True).execute().data or []
    notes = sb.table("notes").select("*").eq("project_id", project_id).order("created_at", desc=True).execute().data or []
    summaries = sb.table("summaries").select("*").eq("project_id", project_id).order("created_at", desc=True).execute().data or []
    return {"project": proj, "recordings": recs, "notes": notes, "summaries": summaries}


@router.patch("/{project_id}")
def update_project(project_id: str, body: ProjectUpdate):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        return {"ok": True}
    res = supabase().table("projects").update(patch).eq("id", project_id).execute()
    return res.data[0]


@router.delete("/{project_id}")
def delete_project(project_id: str):
    supabase().table("projects").delete().eq("id", project_id).execute()
    return {"ok": True}