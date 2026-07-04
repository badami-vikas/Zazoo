import { parseToolManifest, type InternalToolManifest } from "@bridge/tool-kit";

export const companySourcingManifest: InternalToolManifest = parseToolManifest({
  id: "company-sourcing",
  name: "Company Sourcing",
  version: "0.1.0",
  kind: "internal",
  runModes: ["account_bound"],
  provides: [
    { id: "source.company", input: "SourceQuery", output: "CaptureEnvelope[]" },
    { id: "match.company", input: "DedupeCandidate", output: "MatchResult" },
  ],
  capabilities: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "public", accountBoundOnly: true },
}) as InternalToolManifest;
