import { test } from "node:test";
import assert from "node:assert/strict";
import { createFactStore } from "@bridge/facts";
import { recorderManifest } from "../src/manifest.js";
import { createHttpRecorderPort, type SidecarFetch } from "../src/sidecar-port.js";
import { captureAndProcess } from "../src/engine.js";

test("manifest: kind internal, no surfaces, private scope (single-party capture)", () => {
  assert.equal(recorderManifest.kind, "skill");
  assert.equal(recorderManifest.intakePolicy.scope, "private");
  assert.ok(recorderManifest.provides.some((p) => p.id === "capture.transcribe"));
});

test("createHttpRecorderPort: rejects an empty baseUrl instead of defaulting to localhost", () => {
  assert.throws(() => createHttpRecorderPort("", (async () => ({})) as SidecarFetch));
});

test("captureAndProcess: paste -> transcribe -> summarize, each stage recorded as a fact", async () => {
  const calls: string[] = [];
  const fetchImpl: SidecarFetch = async (path) => {
    calls.push(path);
    if (path.endsWith("/recordings/paste")) return { id: "rec_1", projectId: "proj_1", createdAt: "now" };
    if (path.includes("/transcribe")) return { recordingId: "rec_1", text: "hello world" };
    if (path.endsWith("/summaries/generate")) return { id: "sum_1", projectId: "proj_1", text: "short summary" };
    throw new Error(`unexpected path ${path}`);
  };
  const port = createHttpRecorderPort("http://sidecar.local", fetchImpl);
  const facts = createFactStore();

  const { recording, transcript, summary } = await captureAndProcess(port, facts, "event_1", "proj_1", "hello world");

  assert.equal(recording.id, "rec_1");
  assert.equal(transcript.text, "hello world");
  assert.equal(summary.text, "short summary");
  assert.equal(calls.length, 3);

  const profile = facts.livingProfile("event_1");
  assert.equal(profile.transcript?.value, "hello world");
  assert.equal(profile.summary?.provenance, "ai_inferred");
});
