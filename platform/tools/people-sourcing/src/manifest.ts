import {
  parseExecutableManifest,
  type SkillExecutableManifest,
} from "@bridge/capability-kit";

// Skill manifest — no nav entry, no route. Consumed by Modules (DealPilot,
// JobPilot or another Module) through `skillDependencies`, never copied.
export const peopleSourcingManifest: SkillExecutableManifest = parseExecutableManifest({
  id: "people-sourcing",
  name: "People Sourcing",
  version: "0.1.0",
  kind: "skill",
  runModes: ["account_bound"],
  provides: [
    { id: "source.people", input: "SourceQuery", output: "CaptureEnvelope[]" },
    { id: "match.people", input: "DedupeCandidate", output: "MatchResult" },
  ],
  capabilities: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "public", accountBoundOnly: true },
}) as SkillExecutableManifest;
