import {
  parseExecutableManifest,
  type SkillExecutableManifest,
} from "@bridge/capability-kit";

/**
 * Governed JobPilot capability for role-specific resume evaluation. The
 * detailed reasoning workflow lives in the Codex resume-evidence-evaluator
 * skill; this manifest makes its data boundary and model needs explicit to
 * the platform registry.
 */
export const resumeEvidenceEvaluatorManifest: SkillExecutableManifest = parseExecutableManifest({
  id: "resume-evidence-evaluator",
  name: "Resume Evidence Evaluator",
  version: "0.1.0",
  kind: "skill",
  runModes: ["account_bound"],
  modelBindings: [
    { use: "llm", planeDefault: "cloud" },
    { use: "vision", planeDefault: "local" },
  ],
  provides: [
    {
      id: "evaluate.resume",
      input: "ResumeDocument + JobDescription",
      output: "ResumeEvaluation",
    },
  ],
  capabilities: [{ resourceType: "resume", action: "read", dataScope: "private", egress: false }],
  outputContract: [
    {
      from: "ResumeEvaluation",
      to: "Record",
      note: "Scores, evidence labels, visual findings, and grounded/hypothetical rewrites remain reviewable proposals.",
    },
  ],
  intakePolicy: {
    quarantine: true,
    commitVia: "pipeline_proposal",
    scope: "private",
    accountBoundOnly: true,
  },
}) as SkillExecutableManifest;
