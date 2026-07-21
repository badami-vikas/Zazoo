import type { Recording, RecordingUpload, Summary, Transcript } from "./types.js";

// The engine surface: capture.record / capture.transcribe / capture.summarize from the manifest.
// Implementations talk to the FastAPI sidecar over HTTP — never directly to Whisper/the model —
// so composing Modules depend on this typed port, not on the Python process shape.
export interface RecorderPort {
  record(input: RecordingUpload): Promise<Recording>;
  pasteTranscript(projectId: string, text: string): Promise<Recording>;
  transcribe(recordingId: string): Promise<Transcript>;
  summarize(recordingId: string): Promise<Summary>;
}

export interface SidecarFetch {
  (path: string, init?: { method?: string; body?: unknown }): Promise<unknown>;
}

// Default HTTP implementation against Tools/recorder/backend's existing routes. `fetchImpl` is
// injected (default: global fetch) so this stays testable without a live Python process and so
// call sites can point at whatever env-bound URL the platform config resolves (per the plan's
// "env-bound services, fail loud in prod" rule — the base URL is a required constructor arg, not
// a hardcoded default, precisely so a missing env var fails at startup instead of silently
// hitting localhost in production).
export function createHttpRecorderPort(baseUrl: string, fetchImpl: SidecarFetch): RecorderPort {
  if (!baseUrl) throw new Error("createHttpRecorderPort requires a non-empty baseUrl (env-bound, no localhost default)");

  async function post<T>(path: string, body: unknown): Promise<T> {
    return (await fetchImpl(`${baseUrl}${path}`, { method: "POST", body })) as T;
  }

  return {
    async record(input) {
      return post<Recording>("/recordings/upload", { projectId: input.projectId, filename: input.filename });
    },
    async pasteTranscript(projectId, text) {
      return post<Recording>("/recordings/paste", { project_id: projectId, transcript: text });
    },
    async transcribe(recordingId) {
      return post<Transcript>(`/recordings/${recordingId}/transcribe`, {});
    },
    async summarize(recordingId) {
      return post<Summary>("/summaries/generate", { recording_id: recordingId });
    },
  };
}
