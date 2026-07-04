import type { FactStore } from "@bridge/facts";
import type { RecorderPort } from "./sidecar-port.js";

// Runs record -> transcribe -> summarize and records each stage as a fact on the touchpoint
// entity, so a composing external tool (Conference) gets provenance-tagged history for free
// instead of re-plumbing the sidecar calls itself.
export async function captureAndProcess(port: RecorderPort, facts: FactStore, entityId: string, projectId: string, transcriptText: string) {
  const recording = await port.pasteTranscript(projectId, transcriptText);
  facts.append({ entityId, field: "recording_id", value: recording.id, provenance: "user_entered", confidence: 1 });

  const transcript = await port.transcribe(recording.id);
  facts.append({ entityId, field: "transcript", value: transcript.text, provenance: "user_entered", confidence: 1 });

  const summary = await port.summarize(recording.id);
  facts.append({ entityId, field: "summary", value: summary.text, provenance: "ai_inferred", confidence: 0.8 });

  return { recording, transcript, summary };
}
