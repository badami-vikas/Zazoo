from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import get_settings
from .routes import projects, recordings, notes, summaries

app = FastAPI(title="Recorder Tool API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    s = get_settings()
    return {
        "ok": True,
        "transcription_provider": s.transcription_provider,
        "llm_provider": s.llm_provider,
    }


app.include_router(projects.router)
app.include_router(recordings.router)
app.include_router(notes.router)
app.include_router(summaries.router)