from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..db import supabase
from ..services.summarize import generate_summary

router = APIRouter(prefix="/summaries", tags=["summaries"])


class SummaryIn(BaseModel):
    project_id: str
    scope: str = "project"  # "project" or a recording id


@router.post("/generate")
def create_summary(body: SummaryIn):
    try:
        return generate_summary(body.project_id, body.scope)
    except NotImplementedError as e:
        raise HTTPException(501, str(e))
    except Exception as e:
        raise HTTPException(500, f"Summary failed: {e}")


@router.get("")
def list_summaries(project_id: str):
    return (
        supabase()
        .table("summaries")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )