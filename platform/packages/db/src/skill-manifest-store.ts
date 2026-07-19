/**
 * DrizzleSkillManifestRegistry — binds the core `SkillManifestRegistry` port
 * (@bridge/core's skill-manifest.ts) to `skill_manifests` (schema.ts's LAYER
 * 8). Mirrors DrizzleCapabilityStore's shape: jsonb columns validated at the
 * read/write boundary with a colocated Zod schema (@bridge/core stays
 * zero-runtime-deps, no zod there).
 *
 * Unlike Goals/Tasks/child Runs (genuinely dynamic runtime data), the
 * manifest CATALOG's source of truth stays the code declarations in
 * `apps/api/src/wiring.ts` (and `@bridge/integrations-google`'s manifests) —
 * the governed Skill contract is a reviewed, deployed artifact, not something
 * a running server should let drift from what was code-reviewed. `seedSkillManifests`
 * is the boot-time idempotent upsert that makes those code-declared manifests
 * durable/queryable across a restart (mirrors `ensureFoundationalAgentGovernance`'s
 * "code declares, DB durably records" pattern for roles/permissions) — it is
 * NOT a live-editable-in-DB surface; nothing in this file lets a manifest be
 * created that doesn't also exist in the deployed wiring code.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { ChildRunPolicy, DataScope, Plane, RiskBand, SkillManifest, SkillManifestRegistry } from "@bridge/core";
import type { Database } from "./client.js";
import { skillManifests } from "./schema.js";
import {
  withDefaultWorkspace,
  withWorkspaceOnly,
} from "./workspace-context.js";

const stringArraySchema = z.array(z.string());

/** Validate `skill_manifests`' string-array jsonb columns (goal_types, task_types,
 * permissions, data_scopes, default_agents, required_integrations) — throws
 * loudly on a malformed shape rather than silently treating corruption as an
 * empty list (an emptied `permissions`/`dataScopes` list would silently
 * WIDEN what resolveSkillForTask permits — the same governance-hole shape
 * capability-store.ts's `parseDependencies` doc comment warns about). */
function parseStringArray(raw: unknown, column: string): string[] {
  const result = stringArraySchema.safeParse(raw ?? []);
  if (!result.success) {
    throw new Error(`Invalid skill_manifests.${column} jsonb: ${result.error.message}`);
  }
  return result.data;
}

const budgetSchema = z.object({ maxCallsPerDay: z.number().nonnegative().optional(), maxCostPerDay: z.number().nonnegative().optional() }).strict();

function parseBudget(raw: unknown): SkillManifest["budget"] {
  if (raw === null || raw === undefined) return undefined;
  const result = budgetSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid skill_manifests.budget jsonb: ${result.error.message}`);
  }
  // exactOptionalPropertyTypes: strip undefined-valued keys rather than
  // leaving `{ maxCallsPerDay: undefined }`, which is a different (invalid)
  // shape than the key being absent entirely.
  return Object.fromEntries(Object.entries(result.data).filter(([, value]) => value !== undefined)) as SkillManifest["budget"];
}

function unpack(row: typeof skillManifests.$inferSelect): SkillManifest {
  const defaultAgents = row.defaultAgents === null || row.defaultAgents === undefined ? undefined : parseStringArray(row.defaultAgents, "default_agents");
  const requiredIntegrations =
    row.requiredIntegrations === null || row.requiredIntegrations === undefined
      ? undefined
      : parseStringArray(row.requiredIntegrations, "required_integrations");
  const budget = parseBudget(row.budget);
  return {
    workspaceId: row.workspaceId,
    skillId: row.skillId,
    version: row.version,
    goalTypes: parseStringArray(row.goalTypes, "goal_types"),
    taskTypes: parseStringArray(row.taskTypes, "task_types"),
    ...(row.inputSchema !== null && row.inputSchema !== undefined ? { inputSchema: row.inputSchema } : {}),
    ...(row.outputSchema !== null && row.outputSchema !== undefined ? { outputSchema: row.outputSchema } : {}),
    permissions: parseStringArray(row.permissions, "permissions"),
    plane: row.plane as Plane,
    dataScopes: parseStringArray(row.dataScopes, "data_scopes") as DataScope[],
    riskBand: row.riskBand as RiskBand,
    ...(budget ? { budget } : {}),
    evalVersion: row.evalVersion,
    ...(defaultAgents ? { defaultAgents } : {}),
    ...(requiredIntegrations ? { requiredIntegrations } : {}),
    ...(row.childRunPolicy ? { childRunPolicy: row.childRunPolicy as ChildRunPolicy } : {}),
  };
}

export class DrizzleSkillManifestRegistry implements SkillManifestRegistry {
  #db: Database;
  #defaultWorkspaceId: string | undefined;
  #cache = new Map<string, SkillManifest[]>();
  #loaded = false;

  constructor(db: Database, defaultWorkspaceId?: string) {
    this.#db = db;
    this.#defaultWorkspaceId = defaultWorkspaceId;
  }

  /** Load the full catalog from the DB into an in-process read cache. Call once
   * at boot (after `seedSkillManifests`) — `forSkill`/`all` are read on the hot
   * pipeline `propose()` path (@bridge/core's pipeline.ts AGS1 gate) once per
   * request, so this avoids a DB round-trip per proposed action. Safe to call
   * again to pick up a fresh seed (e.g. in tests). */
  async refresh(): Promise<void> {
    const rows = await withDefaultWorkspace(
      this.#db,
      this.#defaultWorkspaceId,
      (tx) => {
        const query = tx.select().from(skillManifests);
        return this.#defaultWorkspaceId
          ? query.where(eq(skillManifests.workspaceId, this.#defaultWorkspaceId))
          : query;
      },
    );
    const next = new Map<string, SkillManifest[]>();
    for (const row of rows) {
      const manifest = unpack(row);
      const key = `${manifest.workspaceId}:${manifest.skillId}`;
      const existing = next.get(key) ?? [];
      existing.push(manifest);
      next.set(key, existing);
    }
    this.#cache = next;
    this.#loaded = true;
  }

  #requireLoaded(): void {
    if (!this.#loaded) {
      throw new Error("skill_manifests: registry read before refresh() — call refresh() once at boot (after seedSkillManifests)");
    }
  }

  forSkill(workspaceId: string, skillId: string): readonly SkillManifest[] {
    this.#requireLoaded();
    return this.#cache.get(`${workspaceId}:${skillId}`) ?? [];
  }

  all(workspaceId: string): readonly SkillManifest[] {
    this.#requireLoaded();
    const prefix = `${workspaceId}:`;
    return [...this.#cache.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .flatMap(([, manifests]) => manifests);
  }
}

/**
 * Idempotently upsert the code-declared manifest catalog into `skill_manifests`
 * (unique on workspace_id+skill_id+version — re-running on every boot with the
 * SAME declarations is a no-op update, not a growing duplicate list).
 */
export async function seedSkillManifests(db: Database, catalog: readonly SkillManifest[]): Promise<void> {
  for (const manifest of catalog) {
    const values = {
      workspaceId: manifest.workspaceId,
      skillId: manifest.skillId,
      version: manifest.version,
      goalTypes: [...manifest.goalTypes],
      taskTypes: [...manifest.taskTypes],
      inputSchema: manifest.inputSchema ?? null,
      outputSchema: manifest.outputSchema ?? null,
      permissions: [...manifest.permissions],
      plane: manifest.plane,
      dataScopes: [...manifest.dataScopes],
      riskBand: manifest.riskBand,
      budget: manifest.budget ?? null,
      evalVersion: manifest.evalVersion,
      defaultAgents: manifest.defaultAgents ? [...manifest.defaultAgents] : null,
      requiredIntegrations: manifest.requiredIntegrations ? [...manifest.requiredIntegrations] : null,
      childRunPolicy: manifest.childRunPolicy ?? null,
    };

    await withWorkspaceOnly(db, manifest.workspaceId, async (tx) => {
      await tx
        .insert(skillManifests)
        .values(values)
        .onConflictDoUpdate({
          target: [
            skillManifests.workspaceId,
            skillManifests.skillId,
            skillManifests.version,
          ],
          set: values,
        });
    });
  }
}
