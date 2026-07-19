import { z } from "zod";

// Manifest contract for executable Skills and surfaced Modules.

const modelBinding = z.object({
  use: z.enum(["vision", "transcription", "llm", "embedding", "other"]),
  planeDefault: z.enum(["local", "cloud"]),
  providers: z
    .object({ local: z.string().optional(), cloud: z.array(z.string()).optional(), envKey: z.string().optional() })
    .optional(),
});

const capability = z.object({
  resourceType: z.string(), // e.g. "person", "memory", "touchpoint", "external:fetch"
  action: z.enum(["read", "write", "send"]),
  dataScope: z.enum(["public", "private", "all"]),
  // egress = crosses the two-plane gate. Per architecture.md this is agent-floor territory —
  // a manifest declaring egress:true does NOT grant it; the Authority resolver still gates it.
  egress: z.boolean(),
});

const outputContractEntry = z.object({
  from: z.string(),
  to: z.enum(["Person", "Community", "Memory", "Touchpoint", "Signal", "Record"]),
  note: z.string().optional(),
});

const intakePolicy = z.object({
  quarantine: z.literal(true), // always true for anything entering the graph — no exceptions
  commitVia: z.literal("pipeline_proposal"),
  scope: z.enum(["public", "private", "all"]),
  accountBoundOnly: z.boolean().optional(),
});

const runMode = z.enum(["standalone", "account_bound"]);

const providesEntry = z.object({
  id: z.string(),
  input: z.string(),
  output: z.string(),
});

const surfaceEntry = z.object({
  route: z.string(),
  nav: z.string().optional(),
  icon: z.string().optional(),
});

const baseFields = {
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  sourceRepo: z.string().optional(),
  internalizedCopyRef: z.string().optional(),
  runModes: z.array(runMode).min(1),
  modelBindings: z.array(modelBinding).default([]),
  capabilities: z.array(capability).default([]),
  outputContract: z.array(outputContractEntry).default([]),
  intakePolicy,
};

export const skillExecutableManifest = z.object({
  ...baseFields,
  kind: z.literal("skill"),
  provides: z.array(providesEntry).min(1),
});

export const moduleExecutableManifest = z.object({
  ...baseFields,
  kind: z.literal("module"),
  surfaces: z.array(surfaceEntry).min(1),
  skillDependencies: z.array(z.string()).default([]),
});

export const executableManifest = z.discriminatedUnion("kind", [
  skillExecutableManifest,
  moduleExecutableManifest,
]);

export type ModelBinding = z.infer<typeof modelBinding>;
export type Capability = z.infer<typeof capability>;
export type OutputContractEntry = z.infer<typeof outputContractEntry>;
export type IntakePolicy = z.infer<typeof intakePolicy>;
export type SkillExecutableManifest = z.infer<typeof skillExecutableManifest>;
export type ModuleExecutableManifest = z.infer<typeof moduleExecutableManifest>;
export type ExecutableManifest = z.infer<typeof executableManifest>;

export function parseExecutableManifest(input: unknown): ExecutableManifest {
  return executableManifest.parse(input);
}
