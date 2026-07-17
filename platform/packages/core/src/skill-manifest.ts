/**
 * Goal/Task-bound Skill manifests + the fail-closed resolver (AGS1,
 * docs/raw/agent-goal-skill-orchestration-plan-2026-07.md §"Skill
 * resolution"). A `SkillManifest` is the governed contract a Skill declares;
 * `resolveSkillForTask` is the ONLY function that decides whether a given
 * (Agent, Goal, Task) triple may use it — never the Agent's identity alone,
 * never a Skill's `defaultAgents` preference, never anything the retrieved
 * content of a request could influence (this module takes no "content"
 * parameter at all — there is no code path here by which ingested data could
 * expand access).
 *
 * `resolveSkillForTask` only ever NARROWS: it reports whether a candidate
 * manifest is eligible, and never mutates or grants anything — the Skill it
 * resolves to already required the Agent to hold its declared permissions
 * ahead of time (Layer 1 below), so this function cannot be used to escalate
 * an Agent's authority (AGS1 deny_rules: "Skill cannot grant itself or its
 * Agent new authority").
 */
import type { DataScope } from "./data-scope.js";
import type { Plane } from "./types.js";
import type { RiskBand } from "./capability/types.js";
import type { Goal, GoalType, Task, TaskType } from "./goal-task.js";

export interface SkillBudget {
  maxCallsPerDay?: number;
  maxCostPerDay?: number;
}

/** Whether a Skill may itself spawn a bounded child Agent Run (child-agent-run.ts).
 * Absent = "forbidden" (the safer default — a Skill must opt in explicitly). */
export type ChildRunPolicy = "forbidden" | "allowed";

/**
 * The governed Skill contract (AGS1 `skill_contract` yaml). One `skillId` may
 * have multiple versions registered; `resolveSkillForTask` picks the highest
 * eligible one. A Skill with NO registered manifest is untouched by this
 * module entirely — it keeps whatever legacy/interim behavior it already had
 * (see pipeline.ts's `propose()`: the AGS1 gate only activates for skill ids
 * that have at least one manifest registered), so introducing this primitive
 * cannot regress any existing ungoverned skill.
 */
export interface SkillManifest {
  /** Owning workspace; a manifest never authorizes work across tenant boundaries. */
  workspaceId: string;
  skillId: string;
  version: string;
  goalTypes: readonly GoalType[];
  taskTypes: readonly TaskType[];
  inputSchema?: unknown;
  outputSchema?: unknown;
  /** Capability-scope tokens ("resourceType:action", "resourceType:*", "*:action",
   * or "*") the invoking Agent must ALREADY hold. This is a requirement the
   * resolver checks — never a grant it confers. */
  permissions: readonly string[];
  plane: Plane;
  /** Data tiers this Skill is allowed to touch. Include "all" to permit any tier. */
  dataScopes: readonly DataScope[];
  riskBand: RiskBand;
  budget?: SkillBudget;
  evalVersion: string;
  /** Preferences surfaced to assignment UI ONLY — see the module doc comment.
   * Never read by `resolveSkillForTask`'s eligibility checks. */
  defaultAgents?: readonly string[];
  requiredIntegrations?: readonly string[];
  childRunPolicy?: ChildRunPolicy;
}

export interface SkillManifestRegistry {
  /** All manifest versions registered under one skill id (empty = ungoverned skill). */
  forSkill(workspaceId: string, skillId: string): readonly SkillManifest[];
  /** The full registered catalog — used for Goal/Task-driven discovery when no
   * skill id is pre-named (`resolveSkillForTask` with `ctx.skillId` omitted). */
  all(workspaceId: string): readonly SkillManifest[];
}

export class InMemorySkillManifestRegistry implements SkillManifestRegistry {
  readonly byId = new Map<string, SkillManifest[]>();

  register(manifest: SkillManifest): void {
    const key = `${manifest.workspaceId}:${manifest.skillId}`;
    const existing = this.byId.get(key) ?? [];
    existing.push(manifest);
    this.byId.set(key, existing);
  }

  forSkill(workspaceId: string, skillId: string): readonly SkillManifest[] {
    return this.byId.get(`${workspaceId}:${skillId}`) ?? [];
  }

  all(workspaceId: string): readonly SkillManifest[] {
    const prefix = `${workspaceId}:`;
    return [...this.byId.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .flatMap(([, manifests]) => manifests);
  }
}

/** Does a capability-scope set cover one required "resourceType:action" token,
 * honoring the same wildcard shapes `agent-scope.ts`'s `scopePermits` and
 * `authority.ts`'s `scopePermits` already use ("*", "resourceType:*", "*:action")?
 * Reimplemented locally (rather than imported) because those two both take a
 * (action, resourceType) PAIR, not a raw token string — manifests declare raw
 * tokens (mirroring how `agents.capabilityScope` itself is stored), so this
 * works directly off the token string instead of re-splitting call sites. */
function scopeCoversToken(scope: ReadonlySet<string>, token: string): boolean {
  if (scope.has(token) || scope.has("*")) return true;
  const idx = token.lastIndexOf(":");
  if (idx > 0) {
    const resourcePart = token.slice(0, idx);
    const actionPart = token.slice(idx + 1);
    if (scope.has(`${resourcePart}:*`)) return true;
    if (scope.has(`*:${actionPart}`)) return true;
  }
  return false;
}

/** Simple, dependency-free semver-ish comparator — good enough for "pick the
 * highest eligible version" over this manifest catalog's `x.y.z` versions
 * (mirrors `skills` table's own `default("1.0.0")` shape; no pre-release/build
 * metadata support needed here). Non-numeric/malformed segments sort as 0. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type SkillResolutionFailureReason =
  | "no-registered-manifest"
  | "workspace-mismatch"
  | "task-inactive"
  | "agent-inactive"
  | "goal-type-mismatch"
  | "task-type-mismatch"
  | "not-assigned-agent"
  | "authority-insufficient"
  | "plane-mismatch"
  | "data-scope-mismatch"
  | "budget-exhausted"
  | "superseded-by-higher-version";

export interface RejectedAlternative {
  skillId: string;
  version: string;
  reason: SkillResolutionFailureReason;
  detail: string;
}

export interface SkillResolutionResult {
  ok: boolean;
  manifest?: SkillManifest;
  reason?: SkillResolutionFailureReason;
  detail?: string;
  /** Every OTHER candidate considered and why it was rejected — AGS1 resolution_order's
   * "record why selected and alternatives rejected." */
  alternativesRejected: RejectedAlternative[];
  /** True when NOTHING is registered for this Goal/Task pair at all — the
   * AGS1 deny_rule "no match means fail closed or request Capability Builder
   * proposal" signal, surfaced so a caller can offer that follow-up action. */
  suggestCapabilityBuilderProposal: boolean;
}

export interface SkillResolutionAgentView {
  id: string;
  workspaceId: string | null;
  active: boolean;
  capabilityScope: readonly string[];
  plane: Plane;
  dataScope: DataScope;
}

export interface SkillResolutionContext {
  goal: Goal;
  task: Task;
  agent: SkillResolutionAgentView;
  requestedDataScope?: DataScope;
  /** Narrow resolution to one skill id (the normal pipeline call shape — the
   * request already names a skill). Omit to search the whole registry for the
   * single best eligible skill, Goal/Task-driven discovery with no skill
   * pre-named. */
  skillId?: string;
  /** Optional budget-usage lookup — a manifest with no `budget` declared
   * always passes (no ceiling to check); a manifest WITH a budget but no
   * `budgetUsedToday` supplied is treated as unused (0), so wiring this is
   * opt-in, never a silent new failure mode for existing callers. */
  budgetUsedToday?: (skillId: string, version: string) => Promise<number> | number;
}

/**
 * Resolve which registered Skill manifest (if any) an Agent may use for a
 * Goal/Task pair, per AGS1's resolution_order:
 *   1. match Goal and Task type
 *   2. verify assigned Agent identity (Task.assignedAgentId === ctx.agent.id —
 *      NOT `manifest.defaultAgents`, which is a preference, never checked here)
 *   3. intersect Agent authority with the manifest's declared permissions
 *   4. verify Plane, data-scope, and budget gates
 *   5. choose the best (highest-version) eligible manifest
 *   6. record why selected and alternatives rejected
 *
 * Deny-by-default: any unmatched/ineligible candidate is filed into
 * `alternativesRejected` with a specific reason, and the overall result is
 * `ok:false` when no candidate survives every gate — there is no partial-credit
 * path, matching every other authority resolver in this codebase.
 */
export async function resolveSkillForTask(
  candidates: readonly SkillManifest[],
  ctx: SkillResolutionContext,
): Promise<SkillResolutionResult> {
  const pool = ctx.skillId ? candidates.filter((m) => m.skillId === ctx.skillId) : candidates;

  if (pool.length === 0) {
    return {
      ok: false,
      reason: "no-registered-manifest",
      detail: ctx.skillId
        ? `no SkillManifest registered for skill "${ctx.skillId}"`
        : "no SkillManifest registered in the supplied catalog",
      alternativesRejected: [],
      suggestCapabilityBuilderProposal: true,
    };
  }

  const rejected: RejectedAlternative[] = [];
  const eligible: SkillManifest[] = [];
  const agentScope = new Set(ctx.agent.capabilityScope);
  const requestedDataScope: DataScope = ctx.requestedDataScope ?? ctx.agent.dataScope;

  for (const manifest of pool) {
    const fail = (reason: SkillResolutionFailureReason, detail: string) => {
      rejected.push({ skillId: manifest.skillId, version: manifest.version, reason, detail });
    };

    if (
      ctx.goal.workspaceId !== ctx.task.workspaceId ||
      ctx.task.goalId !== ctx.goal.id ||
      ctx.agent.workspaceId !== ctx.goal.workspaceId ||
      manifest.workspaceId !== ctx.goal.workspaceId
    ) {
      fail(
        "workspace-mismatch",
        `Goal ${ctx.goal.id}, Task ${ctx.task.id}, Agent ${ctx.agent.id}, and Skill manifest must belong to one workspace`,
      );
      continue;
    }
    if (ctx.task.status !== "open" && ctx.task.status !== "in_progress") {
      fail("task-inactive", `Task ${ctx.task.id} is "${ctx.task.status}", not active`);
      continue;
    }
    if (!ctx.agent.active) {
      fail("agent-inactive", `Agent ${ctx.agent.id} is not active`);
      continue;
    }

    // 1) Goal/Task type match.
    if (!manifest.goalTypes.includes(ctx.goal.type)) {
      fail("goal-type-mismatch", `manifest goalTypes [${manifest.goalTypes.join(", ")}] do not include "${ctx.goal.type}"`);
      continue;
    }
    if (!manifest.taskTypes.includes(ctx.task.type)) {
      fail("task-type-mismatch", `manifest taskTypes [${manifest.taskTypes.join(", ")}] do not include "${ctx.task.type}"`);
      continue;
    }

    // 2) Assigned-Agent identity — default access is a preference, never checked here.
    if (ctx.task.assignedAgentId !== ctx.agent.id) {
      fail(
        "not-assigned-agent",
        `Task ${ctx.task.id} is assigned to "${ctx.task.assignedAgentId}", not "${ctx.agent.id}" — default Agent access never overrides assignment`,
      );
      continue;
    }

    // 3) Agent authority ⊇ manifest permissions (narrowing check only, never a grant).
    const missing = manifest.permissions.filter((token) => !scopeCoversToken(agentScope, token));
    if (missing.length > 0) {
      fail("authority-insufficient", `agent capability scope is missing: ${missing.join(", ")}`);
      continue;
    }

    // 4a) Plane.
    if (manifest.plane !== ctx.agent.plane) {
      fail("plane-mismatch", `manifest requires plane "${manifest.plane}", agent runs on "${ctx.agent.plane}"`);
      continue;
    }

    // 4b) Data scope.
    const agentCoversRequestedData =
      ctx.agent.dataScope === "all" || requestedDataScope === ctx.agent.dataScope;
    if (
      !agentCoversRequestedData ||
      (!manifest.dataScopes.includes("all") && !manifest.dataScopes.includes(requestedDataScope))
    ) {
      fail(
        "data-scope-mismatch",
        `manifest permits [${manifest.dataScopes.join(", ")}], Agent permits "${ctx.agent.dataScope}", request is "${requestedDataScope}"`,
      );
      continue;
    }

    // 4c) Budget.
    if (manifest.budget?.maxCallsPerDay !== undefined) {
      const used = (await ctx.budgetUsedToday?.(manifest.skillId, manifest.version)) ?? 0;
      if (used >= manifest.budget.maxCallsPerDay) {
        fail("budget-exhausted", `daily call budget exhausted (${used}/${manifest.budget.maxCallsPerDay})`);
        continue;
      }
    }

    eligible.push(manifest);
  }

  if (eligible.length === 0) {
    // Report the FIRST rejection reason as the headline (deterministic: pool is
    // iterated in registration order) while still surfacing every alternative.
    const headline = rejected[0];
    return {
      ok: false,
      ...(headline ? { reason: headline.reason, detail: headline.detail } : {}),
      alternativesRejected: rejected,
      suggestCapabilityBuilderProposal: false,
    };
  }

  // 5) Best eligible version.
  eligible.sort((a, b) => compareVersions(b.version, a.version));
  const chosen = eligible[0]!;
  for (const other of eligible.slice(1)) {
    rejected.push({
      skillId: other.skillId,
      version: other.version,
      reason: "superseded-by-higher-version",
      detail: `superseded by eligible version ${chosen.version}`,
    });
  }

  return { ok: true, manifest: chosen, alternativesRejected: rejected, suggestCapabilityBuilderProposal: false };
}
