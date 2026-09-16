/**
 * The intelligence overlay (TASK-114) — the write half of the Intelligence
 * Section, the same shape ADR-263 gave the governance overlay.
 *
 * `get` returns one Module's Agents, Skills, Automations and Integrations as
 * FIELD ROWS rather than as manifest objects: each row carries its label, its
 * current value, whether this Organization has edited it, and — when it cannot
 * be edited — the reason, straight from `MODULE_INTELLIGENCE_FIELDS` in @bridge/core.
 * The page renders rows; it does not decide what is editable, and it cannot
 * disagree with the server about it.
 *
 * `set` writes one entry's patch. It refuses a locked field by name, and it
 * refuses a reference that does not resolve — an Agent pointed at a Skill the
 * Module never shipped, or an Automation pointed at an Agent that does not
 * exist, would be an edit that saved cleanly and broke at run time.
 *
 * The manifest is never touched (ADR-178). Edits that have somewhere to land on
 * a manifest are resolved over it at read time in `modules.list`; the rest
 * (a Skill's description, a connector's name and purpose) are served from here.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  MAX_SCHEDULE_MINUTES,
  MODULE_INTELLIGENCE_FIELDS,
  MODULE_INTELLIGENCE_KINDS,
  moduleIntelligenceField,
  moduleIntelligenceKey,
  readModuleIntelligenceOverlay,
  resolveModuleIntelligence,
  type ModuleIntelligenceKind,
  type ModuleIntelligencePatch,
  type ModuleIntelligenceOverlay,
  type ModuleManifest,
} from "@bridge/core";
import { assertHumanIdentity, procedure, t } from "../router-shared.js";
import type { Wiring } from "../wiring.js";

export const MODULE_INTELLIGENCE_NAMESPACE_PREFIX = "module:intelligence:";

const entryKind = z.enum(["agent", "skill", "automation", "integration"]);

/** The installed Module, or an honest refusal. An overlay stored against a name
 * nothing installed would be an edit the user believes they made. */
async function requireInstalledModule(
  wiring: Pick<Wiring, "moduleStore">,
  organizationId: string,
  moduleName: string,
): Promise<ModuleManifest> {
  const installation = await wiring.moduleStore.getAvailable(organizationId, moduleName);
  if (!installation?.manifest) {
    throw new TRPCError({ code: "NOT_FOUND", message: `No installed Module named ${moduleName}` });
  }
  return installation.manifest;
}

export async function readModuleIntelligenceOverlayFor(
  wiring: Pick<Wiring, "localPlane">,
  organizationId: string,
  moduleName: string,
): Promise<ModuleIntelligenceOverlay | null> {
  return readModuleIntelligenceOverlay(
    await wiring.localPlane.state.read(
      organizationId,
      `${MODULE_INTELLIGENCE_NAMESPACE_PREFIX}${moduleName}`,
    ),
  );
}

/** Values a field row shows, read off the DECLARED manifest. Overlay-only
 * fields have no declared side and read empty. */
function declaredValue(kind: ModuleIntelligenceKind, entry: Record<string, unknown>, field: string): unknown {
  if (kind === "automation" && field === "everyMinutes") {
    const schedule = entry.schedule as { kind?: string; everyMinutes?: number } | undefined;
    return schedule?.kind === "schedule" ? schedule.everyMinutes : null;
  }
  return entry[field] ?? null;
}

/** One Module's entries, flattened to the shape the entry page renders. */
function entriesOf(manifest: ModuleManifest): Array<{
  kind: ModuleIntelligenceKind;
  id: string;
  source: Record<string, unknown>;
}> {
  const rows: Array<{ kind: ModuleIntelligenceKind; id: string; source: Record<string, unknown> }> = [];
  for (const agent of manifest.module?.agents ?? []) {
    rows.push({ kind: "agent", id: agent.id, source: agent as unknown as Record<string, unknown> });
  }
  for (const automation of manifest.module?.automations ?? []) {
    rows.push({
      kind: "automation",
      id: automation.id,
      source: automation as unknown as Record<string, unknown>,
    });
  }
  for (const capability of manifest.capabilities) {
    if (capability.capabilityType === "skill") {
      rows.push({ kind: "skill", id: capability.id, source: capability as unknown as Record<string, unknown> });
    }
  }
  // A connector composed by two capabilities is ONE Integration, not two: it is
  // the same connection to the same outside system, and editing its name twice
  // would be two answers to one question.
  const seen = new Set<string>();
  for (const capability of manifest.capabilities) {
    for (const connector of capability.connectors) {
      if (seen.has(connector.id)) continue;
      seen.add(connector.id);
      rows.push({
        kind: "integration",
        id: connector.id,
        source: { ...connector, usedBy: capability.name } as unknown as Record<string, unknown>,
      });
    }
  }
  return rows;
}

function viewFor(manifest: ModuleManifest, overlay: ModuleIntelligenceOverlay | null) {
  // Field VALUES come from the resolved manifest so the page shows what every
  // other surface shows (ADR-247: the server has the last word), while
  // `declared` stays available beside it so an edit can be seen as an edit.
  const resolved = resolveModuleIntelligence(manifest, overlay);
  const resolvedById = new Map(
    entriesOf(resolved).map((row) => [moduleIntelligenceKey(row.kind, row.id), row.source]),
  );
  const entries = entriesOf(manifest).map((row) => {
    const key = moduleIntelligenceKey(row.kind, row.id);
    const patch = overlay?.entries[key] ?? {};
    const live = resolvedById.get(key) ?? row.source;
    return {
      kind: row.kind,
      id: row.id,
      label: String(live.name ?? live.label ?? row.id),
      edited: Object.keys(patch).length > 0,
      fields: MODULE_INTELLIGENCE_FIELDS[row.kind].map((field) => ({
        ...field,
        // A cadence has nowhere to land on an Automation the Module never gave
        // a schedule: the scheduler reads `schedule`, and an edit here would
        // save cleanly and change nothing — the silent no-op control canon
        // forbids (ADR-045). The row stays VISIBLE and says why.
        ...(row.kind === "automation"
          && field.field === "everyMinutes"
          && (row.source.schedule as { kind?: string } | undefined)?.kind !== "schedule"
          ? {
              lockedReason:
                "This Automation has no schedule — it starts only when something runs it, so there is no cadence for the scheduler to read.",
            }
          : {}),
        value:
          field.field in patch
            ? patch[field.field]
            : declaredValue(row.kind, live, field.field),
        declared: declaredValue(row.kind, row.source, field.field),
        edited: field.field in patch,
      })),
    };
  });
  return {
    moduleName: manifest.name,
    displayName: manifest.module?.displayName ?? manifest.name,
    userEdited: overlay !== null && Object.keys(overlay.entries).length > 0,
    updatedAt: overlay?.updatedAt || null,
    entries,
    // Reference choices, so the page offers what exists rather than a free-text
    // box the server will refuse.
    agentOptions: (resolved.module?.agents ?? []).map((agent) => ({ id: agent.id, name: agent.name })),
    skillOptions: resolved.capabilities
      .filter((capability) => capability.capabilityType === "skill")
      .map((capability) => ({ id: capability.id, name: capability.name })),
  };
}

/** Refuse the write the user cannot see is wrong: a locked field, a wrong type,
 * or a reference to something this Module does not ship. */
function validatePatch(
  manifest: ModuleManifest,
  kind: ModuleIntelligenceKind,
  entryId: string,
  patch: ModuleIntelligencePatch,
): void {
  const entry =
    kind === "automation"
      ? (manifest.module?.automations ?? []).find((automation) => automation.id === entryId)
      : undefined;
  for (const [field, value] of Object.entries(patch)) {
    const spec = moduleIntelligenceField(kind, field);
    if (!spec) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `A ${kind} has no field “${field}”` });
    }
    if (spec.lockedReason) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `“${spec.label}” cannot be edited: ${spec.lockedReason}`,
      });
    }
    if (spec.type === "minutes") {
      if (entry?.schedule?.kind !== "schedule") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This Automation has no schedule — it starts only when something runs it, so there is no cadence for the scheduler to read.",
        });
      }
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_SCHEDULE_MINUTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `“${spec.label}” must be a whole number of minutes between 1 and ${MAX_SCHEDULE_MINUTES}`,
        });
      }
      continue;
    }
    if (spec.type === "skillRefs") {
      const skillIds = manifest.capabilities
        .filter((capability) => capability.capabilityType === "skill")
        .map((capability) => capability.id);
      if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !skillIds.includes(id))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `An Agent may only consume Skills this Module ships: ${skillIds.join(", ") || "none"}`,
        });
      }
      continue;
    }
    if (spec.type === "agentRef") {
      const agentIds = (manifest.module?.agents ?? []).map((agent) => agent.id);
      if (typeof value !== "string" || !agentIds.includes(value)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `An Automation must start a Run on an Agent this Module declares: ${agentIds.join(", ") || "none"}`,
        });
      }
      continue;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `“${spec.label}” cannot be empty` });
    }
    if (value.length > 2000) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `“${spec.label}” is too long` });
    }
  }
}

function assertEntryExists(manifest: ModuleManifest, kind: ModuleIntelligenceKind, id: string): void {
  if (!entriesOf(manifest).some((row) => row.kind === kind && row.id === id)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${manifest.name} declares no ${kind} “${id}”`,
    });
  }
}

export const moduleIntelligenceRouter = t.router({
  /** The editability table itself, so a surface can render an entry kind it
   * has never seen without shipping its own copy of the rules. */
  fields: procedure.query(() => ({
    kinds: MODULE_INTELLIGENCE_KINDS,
    fields: MODULE_INTELLIGENCE_FIELDS,
  })),

  get: procedure
    .input(z.object({ organizationId: z.string().min(1), moduleName: z.string().trim().min(1) }))
    .query(async ({ input, ctx }) => {
      const manifest = await requireInstalledModule(ctx.wiring, input.organizationId, input.moduleName);
      return viewFor(
        manifest,
        await readModuleIntelligenceOverlayFor(ctx.wiring, input.organizationId, input.moduleName),
      );
    }),

  set: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        moduleName: z.string().trim().min(1),
        kind: entryKind,
        entryId: z.string().trim().min(1),
        patch: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Same floor as the governance overlay next door: what a Module's Agent
      // may do is not something an Agent gets to rewrite.
      assertHumanIdentity(ctx, "Editing a Module's intelligence entries");
      const manifest = await requireInstalledModule(ctx.wiring, input.organizationId, input.moduleName);
      assertEntryExists(manifest, input.kind, input.entryId);
      validatePatch(manifest, input.kind, input.entryId, input.patch);
      const updatedAt = ctx.run.clock.nowISO();
      const key = moduleIntelligenceKey(input.kind, input.entryId);
      await ctx.wiring.localPlane.state.update(
        input.organizationId,
        `${MODULE_INTELLIGENCE_NAMESPACE_PREFIX}${input.moduleName}`,
        null,
        (current) => {
          const existing = readModuleIntelligenceOverlay(current);
          const merged = { ...(existing?.entries[key] ?? {}), ...input.patch };
          // An edit set back to the shipped value is not an edit. Dropping it
          // keeps "this Organization changed something" honest, and lets the
          // last such field clear the overlay entirely.
          const entries = { ...(existing?.entries ?? {}) };
          if (Object.keys(merged).length === 0) delete entries[key];
          else entries[key] = merged;
          return { state: { entries, updatedAt }, result: null };
        },
      );
      // Re-read rather than echo the input (ADR-247).
      return viewFor(
        manifest,
        await readModuleIntelligenceOverlayFor(ctx.wiring, input.organizationId, input.moduleName),
      );
    }),

  /** Put one entry back to what its Module shipped. */
  reset: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        moduleName: z.string().trim().min(1),
        kind: entryKind,
        entryId: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertHumanIdentity(ctx, "Resetting a Module's intelligence entries");
      const manifest = await requireInstalledModule(ctx.wiring, input.organizationId, input.moduleName);
      const updatedAt = ctx.run.clock.nowISO();
      const key = moduleIntelligenceKey(input.kind, input.entryId);
      await ctx.wiring.localPlane.state.update(
        input.organizationId,
        `${MODULE_INTELLIGENCE_NAMESPACE_PREFIX}${input.moduleName}`,
        null,
        (current) => {
          const existing = readModuleIntelligenceOverlay(current);
          if (!existing) return { state: null, result: null };
          const entries = { ...existing.entries };
          delete entries[key];
          return {
            state: Object.keys(entries).length === 0 ? null : { entries, updatedAt },
            result: null,
          };
        },
      );
      return viewFor(
        manifest,
        await readModuleIntelligenceOverlayFor(ctx.wiring, input.organizationId, input.moduleName),
      );
    }),
});
