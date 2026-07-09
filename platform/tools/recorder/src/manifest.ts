import { parseToolManifest, type InternalToolManifest } from "@bridge/tool-kit";

// Internal tool manifest for the recorder engine. No nav entry, no route — the standalone
// Tools/recorder Vite UI remains as a dev harness only until its first composing external tool
// (a future Conference tool) ships, per the plan's recorder decomposition note.
export const recorderManifest: InternalToolManifest = parseToolManifest({
  id: "recorder",
  name: "Recorder",
  version: "0.1.0",
  kind: "internal",
  runModes: ["standalone", "account_bound"],
  provides: [
    { id: "capture.record", input: "RecordingUpload", output: "Recording" },
    { id: "capture.transcribe", input: "Recording", output: "Transcript" },
    { id: "capture.summarize", input: "Transcript", output: "Summary" },
  ],
  modelBindings: [{ use: "transcription", planeDefault: "local", providers: { local: "whisper" } }],
  capabilities: [{ resourceType: "memory", action: "write", dataScope: "private", egress: false }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "private" },
}) as InternalToolManifest;
