const BASE = (import.meta as any).env?.VITE_API_BASE || "http://localhost:8000";

async function req<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status} ${r.statusText}: ${t}`);
  }
  return r.json();
}

export type Project = { id: string; name: string; description: string; created_at: string };
export type Recording = {
  id: string;
  project_id: string;
  source_type: "mic" | "upload" | "paste";
  transcript: string | null;
  audio_storage_path: string | null;
  duration_seconds: number | null;
  status: "pending" | "transcribing" | "done" | "error";
  error_message?: string | null;
  created_at: string;
};
export type Note = { id: string; project_id: string; content: string; created_at: string };
export type NextStep = { text: string; owner?: string | null; due?: string | null };
export type Summary = {
  id: string;
  project_id: string;
  summary: string;
  next_steps: NextStep[];
  scope: string;
  llm_provider: string;
  llm_model: string;
  created_at: string;
};

export const api = {
  health: () => req("/health"),
  listProjects: () => req<Project[]>("/projects"),
  createProject: (name: string, description = "") =>
    req<Project>("/projects", { method: "POST", body: JSON.stringify({ name, description }) }),
  getProject: (id: string) =>
    req<{ project: Project; recordings: Recording[]; notes: Note[]; summaries: Summary[] }>(`/projects/${id}`),
  deleteProject: (id: string) => req(`/projects/${id}`, { method: "DELETE" }),

  uploadRecording: async (projectId: string, file: Blob, sourceType: "mic" | "upload", filename: string) => {
    const fd = new FormData();
    fd.append("project_id", projectId);
    fd.append("source_type", sourceType);
    fd.append("file", file, filename);
    const r = await fetch(`${BASE}/recordings/upload`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json() as Promise<Recording>;
  },
  pasteTranscript: (projectId: string, transcript: string) =>
    req<Recording>("/recordings/paste", {
      method: "POST",
      body: JSON.stringify({ project_id: projectId, transcript }),
    }),
  getRecording: (id: string) => req<Recording>(`/recordings/${id}`),
  getAudioUrl: (id: string) => req<{ url: string }>(`/recordings/${id}/audio-url`),
  deleteRecording: (id: string) => req(`/recordings/${id}`, { method: "DELETE" }),

  addNote: (projectId: string, content: string) =>
    req<Note>("/notes", { method: "POST", body: JSON.stringify({ project_id: projectId, content }) }),
  deleteNote: (id: string) => req(`/notes/${id}`, { method: "DELETE" }),

  generateSummary: (projectId: string, scope: string = "project") =>
    req<Summary>("/summaries/generate", {
      method: "POST",
      body: JSON.stringify({ project_id: projectId, scope }),
    }),
};
