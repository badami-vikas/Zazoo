from __future__ import annotations
import json
import re
from pathlib import Path
from ..db import supabase
from ..providers import get_llm_provider


PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "summary.txt"


def _load_system_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _build_user_payload(project: dict, transcripts: list[dict], notes: list[dict]) -> str:
    parts: list[str] = []
    parts.append(f"# Project: {project['name']}")
    if project.get("description"):
        parts.append(f"Description: {project['description']}")
    parts.append("")

    if notes:
        parts.append("## Context notes")
        for n in notes:
            parts.append(f"- [{n['created_at']}] {n['content']}")
        parts.append("")

    if transcripts:
        parts.append("## Conversation transcripts")
        for i, r in enumerate(transcripts, 1):
            parts.append(f"### Recording {i} ({r['source_type']}, {r['created_at']})")
            parts.append(r.get("transcript") or "(empty)")
            parts.append("")
    else:
        parts.append("(No transcripts attached.)")

    return "\n".join(parts)


def _extract_json(raw: str) -> dict:
    raw = raw.strip()
    # Strip code fences if the model wrapped output in ```json ... ```
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.S)
    if fenced:
        raw = fenced.group(1)
    # Fallback: first {...} block
    if not raw.startswith("{"):
        m = re.search(r"\{.*\}", raw, re.S)
        if m:
            raw = m.group(0)
    return json.loads(raw)


def generate_summary(project_id: str, scope: str = "project") -> dict:
    sb = supabase()
    project = sb.table("projects").select("*").eq("id", project_id).single().execute().data
    if not project:
        raise ValueError(f"Project {project_id} not found")

    if scope == "project":
        recs = sb.table("recordings").select("*").eq("project_id", project_id).eq("status", "done").order("created_at").execute().data or []
    else:
        # scope is a recording id
        rec = sb.table("recordings").select("*").eq("id", scope).single().execute().data
        recs = [rec] if rec else []

    notes = sb.table("notes").select("*").eq("project_id", project_id).order("created_at").execute().data or []

    system = _load_system_prompt()
    user = _build_user_payload(project, recs, notes)

    provider = get_llm_provider()
    result = provider.complete(system, user)

    try:
        parsed = _extract_json(result.text)
        summary_text = parsed.get("summary", "").strip()
        next_steps = parsed.get("next_steps", [])
        if not isinstance(next_steps, list):
            next_steps = []
    except Exception:
        # Fall back to raw text if model didn't return valid JSON
        summary_text = result.text.strip()
        next_steps = []

    row = {
        "project_id": project_id,
        "summary": summary_text,
        "next_steps": next_steps,
        "scope": scope,
        "llm_provider": provider.name,
        "llm_model": result.model,
    }
    saved = sb.table("summaries").insert(row).execute().data[0]
    return saved
