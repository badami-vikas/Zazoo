/**
 * Editable intelligence entries (TASK-114).
 *
 * User directive 2026-09-11, verbatim: *"Literally I want everything can be
 * edited, editable. Not being able to edit should be an rare exception"*.
 *
 * WHAT WAS WRONG. A Module's Agents, Skills, Automations and Integrations were
 * rendered from the manifest and were read-only everywhere — not because
 * anyone decided they should be, but because the manifest is immutable
 * (ADR-178) and nothing held the user's own edits. Read-only was the default by
 * omission. This file inverts that: editing is the default, and a field that
 * cannot be edited must SAY WHY, in a string the surface renders in place.
 *
 * THE SHAPE IS THE GOVERNANCE OVERLAY'S (ADR-263). Manifests stay immutable; an
 * Organization's edits live on the Local Plane, keyed by Organization + Module,
 * and are resolved over the declared manifest at read time. Reset removes the
 * overlay and the shipped declaration comes back. Nothing here mutates a
 * manifest.
 *
 * WHY A TABLE AND NOT `if` STATEMENTS. ADR-247: encode knowledge as data. The
 * server refuses a write to a locked field by reading {@link MODULE_INTELLIGENCE_FIELDS},
 * and the UI greys the same field out with the same reason from the same row.
 * One table, both sides — so a lock cannot exist on one surface and not the
 * other, and the count of locked fields is something you can enumerate rather
 * than something you have to go looking for.
 *
 * WHAT IS DELIBERATELY NOT HERE. No `enabled` toggle on a Skill or a connector.
 * Nothing in the runtime reads such a flag today, and a switch that silently
 * changes nothing is the failure this repo keeps re-learning (ADR-045). When
 * the runtime can honour it, it becomes a row in this table.
 */
import type { CapabilityManifest } from "../capability/types.js";
import { MAX_SCHEDULE_MINUTES } from "../automation-trigger.js";
import type { ModuleManifest } from "./types.js";

/** The four kinds of intelligence entry a Module carries. */
export type ModuleIntelligenceKind = "agent" | "skill" | "automation" | "integration";

export const MODULE_INTELLIGENCE_KINDS: readonly ModuleIntelligenceKind[] = [
  "agent",
  "skill",
  "automation",
  "integration",
];

/** How a field is edited. The surface picks its control from this, so a new
 * field never needs a new branch in the page. */
export type ModuleIntelligenceFieldType = "text" | "longtext" | "minutes" | "agentRef" | "skillRefs";

export interface ModuleIntelligenceField {
  field: string;
  label: string;
  type: ModuleIntelligenceFieldType;
  /**
   * Absent means editable — the default.
   *
   * Present means this one field is the exception, and the string is the reason
   * the user reads next to the disabled control. A locked field with no reason
   * is not allowed to exist: that is precisely the silent read-only this task
   * was filed against.
   */
  lockedReason?: string;
}

/**
 * Every field of every entry kind, editable or locked with its reason.
 *
 * The locks are the four boundaries the rest of the platform already enforces,
 * and each one would be a way to grant authority the Module never declared:
 * identity (things other rows point at), the governed capability, residency,
 * and the signed/scanned trust claim.
 */
export const MODULE_INTELLIGENCE_FIELDS: Record<ModuleIntelligenceKind, readonly ModuleIntelligenceField[]> = {
  agent: [
    {
      field: "id",
      label: "Identifier",
      type: "text",
      lockedReason:
        "Runs, Automations and governance rules point at this id. Renaming it would orphan them.",
    },
    { field: "name", label: "Name", type: "text" },
    {
      field: "capabilityId",
      label: "Capability",
      type: "text",
      lockedReason:
        "The capability is the governed unit — its permissions and trust lifecycle are what this Agent may do. Changing it here would grant authority the Module never declared.",
    },
    { field: "skillIds", label: "Skills", type: "skillRefs" },
    {
      field: "plane",
      label: "Plane",
      type: "text",
      lockedReason: "Local or Cloud is a residency boundary, not a preference (ADR-246/248).",
    },
    {
      field: "runRoute",
      label: "Runs page",
      type: "text",
      lockedReason: "The Runs surface is a Page the Module ships; it exists only where the Module built it.",
    },
  ],
  skill: [
    {
      field: "id",
      label: "Identifier",
      type: "text",
      lockedReason: "The Agents allowed to invoke this Skill reference it by id.",
    },
    { field: "name", label: "Name", type: "text" },
    { field: "description", label: "What it is for", type: "longtext" },
    {
      field: "permissions",
      label: "Permissions",
      type: "text",
      lockedReason:
        "Permissions are the signed trust claim the publish gate scanned. Editing them here would change what was scanned without re-scanning it.",
    },
    {
      field: "connectors",
      label: "Connectors",
      type: "text",
      lockedReason: "Part of the same signed trust claim as permissions.",
    },
    {
      field: "version",
      label: "Version",
      type: "text",
      lockedReason: "A Module version resolves to exactly one manifest for everyone who installs it (ADR-178).",
    },
  ],
  automation: [
    {
      field: "id",
      label: "Identifier",
      type: "text",
      lockedReason: "The scheduler and the Run history reference this id.",
    },
    { field: "name", label: "Name", type: "text" },
    { field: "trigger", label: "Trigger", type: "text" },
    { field: "agentId", label: "Agent", type: "agentRef" },
    { field: "everyMinutes", label: "Runs every (minutes)", type: "minutes" },
    {
      field: "capabilityId",
      label: "Capability",
      type: "text",
      lockedReason: "Same reason as an Agent's: the capability is what is governed.",
    },
    {
      field: "procedure",
      label: "Procedure",
      type: "text",
      lockedReason: "The server procedure this Automation calls is code the Module ships.",
    },
  ],
  integration: [
    {
      field: "id",
      label: "Connector",
      type: "text",
      lockedReason: "The capabilities that compose this connector reference it by id.",
    },
    { field: "label", label: "Name", type: "text" },
    { field: "purpose", label: "Why it is connected", type: "longtext" },
    {
      field: "externalSend",
      label: "Can send externally",
      type: "text",
      lockedReason:
        "Whether a connector sends outside is an egress boundary; the lethal-trifecta scan is computed from it (ADR-282).",
    },
  ],
};

/** The field row, or undefined when the kind has no such field. */
export function moduleIntelligenceField(
  kind: ModuleIntelligenceKind,
  field: string,
): ModuleIntelligenceField | undefined {
  return MODULE_INTELLIGENCE_FIELDS[kind].find((entry) => entry.field === field);
}

/** Editable field names for a kind — what a write is allowed to carry. */
export function editableModuleIntelligenceFields(kind: ModuleIntelligenceKind): string[] {
  return MODULE_INTELLIGENCE_FIELDS[kind].filter((entry) => !entry.lockedReason).map((entry) => entry.field);
}

/** One entry's user edits: field name → value, editable fields only. */
export type ModuleIntelligencePatch = Record<string, unknown>;

/**
 * An Organization's edits to one Module's intelligence entries.
 *
 * Keyed `<kind>:<id>` in one flat map rather than four nested ones: an entry
 * is identified by its kind and its id everywhere else in this file, and a flat
 * key means adding a fifth kind adds no structure.
 */
export interface ModuleIntelligenceOverlay {
  entries: Record<string, ModuleIntelligencePatch>;
  updatedAt: string;
}

export function moduleIntelligenceKey(kind: ModuleIntelligenceKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Parse a stored overlay row, or `null` when there isn't a usable one.
 *
 * Unlike the governance overlay, "empty" here is harmless — no edits means the
 * manifest stands — so a corrupt row degrades to `null` and the shipped
 * declaration is what the user sees. Unknown or locked fields inside a patch
 * are DROPPED rather than failing the whole row: a lock added after an edge
 * case was already saved must take effect, not strand every other edit
 * alongside it.
 */
export function readModuleIntelligenceOverlay(raw: unknown): ModuleIntelligenceOverlay | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { entries, updatedAt } = raw as Record<string, unknown>;
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) return null;
  const parsed: Record<string, ModuleIntelligencePatch> = {};
  for (const [key, patch] of Object.entries(entries as Record<string, unknown>)) {
    const kind = key.slice(0, key.indexOf(":")) as ModuleIntelligenceKind;
    if (!MODULE_INTELLIGENCE_KINDS.includes(kind)) continue;
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) continue;
    const editable = new Set(editableModuleIntelligenceFields(kind));
    const kept: ModuleIntelligencePatch = {};
    for (const [field, value] of Object.entries(patch as Record<string, unknown>)) {
      if (editable.has(field)) kept[field] = value;
    }
    if (Object.keys(kept).length > 0) parsed[key] = kept;
  }
  return { entries: parsed, updatedAt: typeof updatedAt === "string" ? updatedAt : "" };
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/**
 * The manifest as this Organization has edited it.
 *
 * Applied at every read of an installed Module (modules.list), so the Agent
 * page, the Intelligence Section and the Module's manifest view all show the
 * same thing — there is no surface that shows the shipped name after the user
 * renamed it.
 *
 * Only fields that EXIST on the manifest types are applied here. The
 * overlay-only fields (a Skill's description, a connector's label and purpose)
 * have nowhere to live in a manifest and are served by `moduleIntelligence.get`
 * instead; putting them here would mean inventing manifest fields no Module
 * ever declared.
 */
export function resolveModuleIntelligence(
  manifest: ModuleManifest,
  overlay: ModuleIntelligenceOverlay | null,
): ModuleManifest {
  if (!overlay || Object.keys(overlay.entries).length === 0) return manifest;
  const patch = (kind: ModuleIntelligenceKind, id: string): ModuleIntelligencePatch =>
    overlay.entries[moduleIntelligenceKey(kind, id)] ?? {};

  const capabilities: CapabilityManifest[] = manifest.capabilities.map((capability) => {
    if (capability.capabilityType !== "skill") return capability;
    const name = asString(patch("skill", capability.id).name);
    return name ? { ...capability, name } : capability;
  });

  const module = manifest.module
    ? {
        ...manifest.module,
        agents: manifest.module.agents.map((agent) => {
          const edits = patch("agent", agent.id);
          const name = asString(edits.name);
          const skillIds = Array.isArray(edits.skillIds)
            ? edits.skillIds.filter((id): id is string => typeof id === "string")
            : null;
          return { ...agent, ...(name ? { name } : {}), ...(skillIds ? { skillIds } : {}) };
        }),
        automations: manifest.module.automations.map((automation) => {
          const edits = patch("automation", automation.id);
          const name = asString(edits.name);
          const trigger = asString(edits.trigger);
          const agentId = asString(edits.agentId);
          const everyMinutes =
            typeof edits.everyMinutes === "number"
            && Number.isInteger(edits.everyMinutes)
            && edits.everyMinutes >= 1
            && edits.everyMinutes <= MAX_SCHEDULE_MINUTES
              ? edits.everyMinutes
              : null;
          return {
            ...automation,
            ...(name ? { name } : {}),
            ...(trigger ? { trigger } : {}),
            ...(agentId ? { agentId } : {}),
            // A cadence only has somewhere to land on an Automation that
            // already declares a schedule; giving one to a manual Automation
            // would claim the scheduler runs it, and nothing installs it there.
            ...(everyMinutes !== null && automation.schedule?.kind === "schedule"
              ? { schedule: { kind: "schedule" as const, everyMinutes } }
              : {}),
          };
        }),
      }
    : manifest.module;

  return { ...manifest, capabilities, ...(module ? { module } : {}) };
}
