import {
  parseExecutableManifest,
  type SkillExecutableManifest,
} from "@bridge/capability-kit";

// Recorder Skill manifest. No nav entry or route; the standalone Vite UI is a development
// harness until a surfaced Module composes these capture Skills.
export const recorderManifest: SkillExecutableManifest = parseExecutableManifest({
  id: "recorder",
  name: "Recorder",
  version: "0.1.0",
  kind: "skill",
  runModes: ["standalone", "account_bound"],
  provides: [
    { id: "capture.record", input: "RecordingUpload", output: "Recording" },
    { id: "capture.transcribe", input: "Recording", output: "Transcript" },
    { id: "capture.summarize", input: "Transcript", output: "Summary" },
  ],
  modelBindings: [{ use: "transcription", planeDefault: "local", providers: { local: "whisper" } }],
  capabilities: [{ resourceType: "memory", action: "write", dataScope: "private", egress: false }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "private" },
}) as SkillExecutableManifest;
