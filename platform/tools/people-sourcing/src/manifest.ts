import { parseToolManifest, type InternalToolManifest } from "@bridge/tool-kit";

// Internal tool manifest — no nav entry, no route. Consumed by external tools (DealPilot,
// JobPilot, a future Conference tool) via `composes: ["people-sourcing"]`, never copied.
export const peopleSourcingManifest: InternalToolManifest = parseToolManifest({
  id: "people-sourcing",
  name: "People Sourcing",
  version: "0.1.0",
  kind: "internal",
  runModes: ["account_bound"],
  provides: [
    { id: "source.people", input: "SourceQuery", output: "CaptureEnvelope[]" },
    { id: "match.people", input: "DedupeCandidate", output: "MatchResult" },
  ],
  capabilities: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "public", accountBoundOnly: true },
}) as InternalToolManifest;
