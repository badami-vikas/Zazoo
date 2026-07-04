import { z } from "zod";

// The single manifest contract for every Bridge tool — internal (headless capability) or
// external (UI surface). See docs/raw/tool-standardization-plan.md (ADR-006) +
// docs/raw/tools-internalization.md. "Manifest first" is a hard rule: no tool ships without
// one, and the tool registry is DERIVED from these, never hand-maintained separately.

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
  to: z.enum(["Person", "Community", "Memory", "Touchpoint", "Signal", "Initiative"]),
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

// Internal tool: a headless capability. No nav, no route — mounted by external tools or
// rituals via `composes`. Declares what it PROVIDES.
export const internalToolManifest = z.object({
  ...baseFields,
  kind: z.literal("internal"),
  provides: z.array(providesEntry).min(1),
});

// External tool: a UI surface. Declares its routes/nav AND which internal tools it composes.
// Must not re-declare capability it gets for free by composing (compose, don't copy).
export const externalToolManifest = z.object({
  ...baseFields,
  kind: z.literal("external"),
  surfaces: z.array(surfaceEntry).min(1),
  composes: z.array(z.string()).default([]),
});

export const toolManifest = z.discriminatedUnion("kind", [internalToolManifest, externalToolManifest]);

export type ModelBinding = z.infer<typeof modelBinding>;
export type Capability = z.infer<typeof capability>;
export type OutputContractEntry = z.infer<typeof outputContractEntry>;
export type IntakePolicy = z.infer<typeof intakePolicy>;
export type InternalToolManifest = z.infer<typeof internalToolManifest>;
export type ExternalToolManifest = z.infer<typeof externalToolManifest>;
export type ToolManifest = z.infer<typeof toolManifest>;

export function parseToolManifest(input: unknown): ToolManifest {
  return toolManifest.parse(input);
}
