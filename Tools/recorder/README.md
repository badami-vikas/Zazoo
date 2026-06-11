# Recorder

A local web app to **create projects, record conversations** (mic / file upload / pasted transcript), **add context notes** over time, and **generate summaries + actionable next steps**.

- **Backend:** FastAPI (Python 3.11+)
- **Frontend:** Vite + React + TypeScript
- **Storage:** Supabase (Postgres + Storage bucket)
- **Transcription:** [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) (local, open-source)
- **Summarization:** [Ollama](https://ollama.com) (local, open-source LLM)
- **Future:** OpenAI Whisper API / Anthropic Claude / OpenAI GPT — switch by changing a single env var. Stubs already in place.

---

## 1. Supabase setup (one-time)

1. Create a free project at [supabase.com](https://supabase.com).
2. SQL Editor → paste `supabase/schema.sql` → run.
3. Storage → New bucket → name it `recordings` → **Private**.
4. Settings → API → copy the **Project URL** and **service_role** key.

## 2. Install system deps

- **ffmpeg** (required by `pydub` for audio normalization)
  ```bash
  brew install ffmpeg
  ```
- **Ollama** (local LLM)
  ```bash
  brew install ollama
  ollama serve &           # runs at http://localhost:11434
  ollama pull llama3.1:8b  # ~5GB; or try qwen2.5:7b
  ```

## 3. Backend

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
# edit .env — paste SUPABASE_URL + SUPABASE_SERVICE_KEY
uvicorn app.main:app --reload --port 8000
```

Sanity check:
```bash
curl http://localhost:8000/health
# { "ok": true, "transcription_provider": "whisper_local", "llm_provider": "ollama_local" }
```

On first transcribe, `faster-whisper` will download the model (`base.en` is ~150MB).

## 4. Frontend

```bash
cd frontend
npm install
cp .env.example .env       # VITE_API_BASE defaults to http://localhost:8000
npm run dev
# open http://localhost:5173
```

## 5. End-to-end smoke test

```bash
# Create a project
PROJ=$(curl -s -X POST http://localhost:8000/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","description":"smoke"}' | python -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# Paste a transcript
curl -s -X POST http://localhost:8000/recordings/paste \
  -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PROJ\",\"transcript\":\"We agreed to ship the beta on Friday. Anna will draft the launch email by Wednesday. Open question: pricing tiers.\"}"

# Add a note
curl -s -X POST http://localhost:8000/notes \
  -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PROJ\",\"content\":\"Stakeholder: CTO is the final approver on pricing.\"}"

# Generate summary
curl -s -X POST http://localhost:8000/summaries/generate \
  -H 'Content-Type: application/json' \
  -d "{\"project_id\":\"$PROJ\",\"scope\":\"project\"}"
```

You should get back a JSON object with `summary` and `next_steps`.

---

## Switching providers later

In `backend/.env`:

| Setting                    | Default          | API alternatives                    |
| -------------------------- | ---------------- | ----------------------------------- |
| `TRANSCRIPTION_PROVIDER`   | `whisper_local`  | `openai_api`                        |
| `LLM_PROVIDER`             | `ollama_local`   | `anthropic_api`, `openai_api`       |

The stub providers (`backend/app/providers/{transcription,llm}/*_api.py`) raise `NotImplementedError` with a pointer to where to implement them — wire up the SDK call, paste your key, restart.

---

## Project layout

```
recorder/
├── backend/
│   ├── app/
│   │   ├── main.py              FastAPI app + CORS
│   │   ├── config.py            env-driven settings + provider selection
│   │   ├── db.py                Supabase client
│   │   ├── routes/              projects, recordings, notes, summaries
│   │   ├── providers/
│   │   │   ├── transcription/   whisper_local (default), openai_api (stub)
│   │   │   └── llm/             ollama_local (default), anthropic_api, openai_api (stubs)
│   │   ├── services/            transcribe.py, summarize.py
│   │   └── prompts/summary.txt  editable prompt template
│   ├── pyproject.toml
│   └── .env.example
├── frontend/                    Vite + React + TS
│   └── src/{pages,components,lib}
├── supabase/schema.sql
└── README.md
```

## Notes

- v1 has no auth — it's local-only. Schema is RLS-ready when you add Supabase Auth.
- Background transcription uses FastAPI `BackgroundTasks`. Swap for RQ/Celery if you ever queue many long recordings.
- The frontend polls `GET /recordings/{id}` every 2.5s while a recording is `transcribing`. Easy upgrade to Supabase Realtime later.
