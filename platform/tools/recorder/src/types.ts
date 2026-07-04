// Typed shapes mirroring the existing FastAPI sidecar's contract (Tools/recorder/backend/app/
// routes/{recordings,notes,summaries,projects}.py) — this package does not reimplement capture
// or Whisper transcription, it wraps the existing Python service as a sidecar, same pattern as
// Docling/Resume-Matcher (packages/extraction, future JobPilot scorers).

export interface Recording {
  id: string;
  projectId: string;
  audioUrl?: string;
  transcript?: string;
  createdAt: string;
}

export interface Transcript {
  recordingId: string;
  text: string;
}

export interface Summary {
  id: string;
  projectId: string;
  recordingId?: string;
  text: string;
}

export interface RecordingUpload {
  projectId: string;
  audioBlob: Blob | Buffer;
  filename: string;
}
