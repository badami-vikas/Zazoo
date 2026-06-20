/**
 * In-memory port implementations. Let core run + be tested with no database.
 * The Drizzle/Supabase implementations in `@bridge/db` bind the same interfaces.
 */
import type {
  AgentQuery,
  EphemeralQuery,
  EventBus,
  LedgerStore,
  LocalMediaStore,
  MediaCaptureRecord,
  MediaKind,
  MediaStatus,
  PolicyEvalInput,
  PolicyStore,
  RitualDefinition,
  RitualRegistry,
  RitualRunRecorder,
  ToolRegistry,
  RoleQuery,
  RunCtx,
  Skill,
  SkillRegistry,
  VarianceAdjuster,
} from "../ports.js";
import type {
  Actor,
  DomainEvent,
  GrantRule,
  LedgerEntry,
  PolicyResult,
  RunContext,
} from "../types.js";
import type { DataScope } from "../data-scope.js";

export class InMemoryRoleStore implements RoleQuery {
  /** principalKey(`${type}:${id}`) -> roleIds */
  readonly principalRoles = new Map<string, string[]>();
  readonly roleGrants = new Map<string, GrantRule[]>();
  readonly direct = new Map<string, GrantRule[]>();

  static key(actor: Actor): string {
    return `${actor.type}:${actor.id}`;
  }

  async rolesForPrincipal(_ws: string, actor: Actor): Promise<string[]> {
    return this.principalRoles.get(InMemoryRoleStore.key(actor)) ?? [];
  }
  async grantsForRole(roleId: string): Promise<GrantRule[]> {
    return this.roleGrants.get(roleId) ?? [];
  }
  async directGrants(_ws: string, actor: Actor): Promise<GrantRule[]> {
    return this.direct.get(InMemoryRoleStore.key(actor)) ?? [];
  }
}

export class InMemoryAgentStore implements AgentQuery {
  readonly assumed = new Map<string, string | null>();
  readonly scope = new Map<string, string[]>();
  /** Per-agent data-tier ceiling. Default 'all' when unset. */
  readonly tiers = new Map<string, DataScope>();
  /** Per-agent skill allow-list. Empty/unset = unrestricted. */
  readonly skills = new Map<string, string[]>();

  async assumedRole(agentId: string): Promise<string | null> {
    return this.assumed.get(agentId) ?? null;
  }
  async capabilityScope(agentId: string): Promise<string[]> {
    return this.scope.get(agentId) ?? [];
  }
  async dataScope(agentId: string): Promise<DataScope> {
    return this.tiers.get(agentId) ?? "all";
  }
  async allowedSkills(agentId: string): Promise<string[]> {
    return this.skills.get(agentId) ?? [];
  }
}

interface StoredEphemeral extends GrantRule {
  actorKey: string;
  contextId?: string;
  expiresAtISO: string;
  consumed: boolean;
}

export class InMemoryEphemeralStore implements EphemeralQuery {
  readonly grants: StoredEphemeral[] = [];

  mint(actor: Actor, grant: GrantRule, expiresAtISO: string, contextId?: string): void {
    this.grants.push({
      ...grant,
      actorKey: InMemoryRoleStore.key(actor),
      ...(contextId ? { contextId } : {}),
      expiresAtISO,
      consumed: false,
    });
  }

  async activeGrants(
    _ws: string,
    actor: Actor,
    context: RunContext | undefined,
    nowISO: string,
  ): Promise<GrantRule[]> {
    const key = InMemoryRoleStore.key(actor);
    const now = Date.parse(nowISO);
    return this.grants
      .filter((g) => {
        if (g.actorKey !== key) return false;
        if (g.consumed) return false;
        if (Date.parse(g.expiresAtISO) <= now) return false;
        if (g.contextId && g.contextId !== context?.id) return false;
        return true;
      })
      .map(({ resourceType, resourceId, action, effect }) => ({
        resourceType,
        resourceId,
        action,
        effect,
      }));
  }
}

/** Policy store driven by a list of evaluator functions. Order = priority. */
export type PolicyFn = (input: PolicyEvalInput) => PolicyResult | null;

export class InMemoryPolicyStore implements PolicyStore {
  readonly policies: PolicyFn[];
  constructor(policies: PolicyFn[] = []) {
    this.policies = policies;
  }
  async evaluate(input: PolicyEvalInput): Promise<PolicyResult[]> {
    const out: PolicyResult[] = [];
    for (const p of this.policies) {
      const r = p(input);
      if (r) out.push(r);
    }
    return out;
  }
}

export class InMemoryLedger implements LedgerStore {
  readonly entries: LedgerEntry[] = [];
  async append(entry: LedgerEntry): Promise<LedgerEntry> {
    // Append-only: enforce no duplicate id, never overwrite.
    if (this.entries.some((e) => e.id === entry.id)) {
      throw new Error(`ledger: duplicate id ${entry.id} (append-only violation)`);
    }
    this.entries.push(entry);
    return entry;
  }
  async get(id: string): Promise<LedgerEntry | null> {
    return this.entries.find((e) => e.id === id) ?? null;
  }
  async decisionFor(proposalId: string): Promise<LedgerEntry | null> {
    return this.entries.find((e) => e.refLedgerId === proposalId && e.userDecision !== null) ?? null;
  }
}

export class InMemoryEventBus implements EventBus {
  readonly events: DomainEvent[] = [];
  async emit(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }
}

/**
 * In-memory LOCAL-plane media store — blobs live in a Map, never crossing the gate.
 * The pglite (bytea) adapter in `@bridge/db` binds the same `LocalMediaStore` port.
 * Append-only put (duplicate id throws); blob + identity fields immutable on update;
 * archive() is a soft delete.
 */
export class InMemoryMediaStore implements LocalMediaStore {
  readonly records = new Map<string, MediaCaptureRecord>();
  readonly blobs = new Map<string, Uint8Array>();

  async put(rec: MediaCaptureRecord, blob: Uint8Array): Promise<MediaCaptureRecord> {
    if (this.records.has(rec.id)) {
      throw new Error(`media: duplicate id ${rec.id} (append-only violation)`);
    }
    this.records.set(rec.id, { ...rec });
    this.blobs.set(rec.id, blob);
    return { ...rec };
  }
  async get(id: string): Promise<MediaCaptureRecord | null> {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }
  async getBlob(id: string): Promise<Uint8Array | null> {
    return this.blobs.get(id) ?? null;
  }
  async list(filter?: { status?: MediaStatus; kind?: MediaKind; workspaceId?: string }): Promise<MediaCaptureRecord[]> {
    return [...this.records.values()]
      .filter((r) => (filter?.status ? r.status === filter.status : true))
      .filter((r) => (filter?.kind ? r.kind === filter.kind : true))
      .filter((r) => (filter?.workspaceId ? r.workspaceId === filter.workspaceId : true))
      .map((r) => ({ ...r }));
  }
  async update(id: string, patch: Partial<MediaCaptureRecord>): Promise<MediaCaptureRecord> {
    const r = this.records.get(id);
    if (!r) throw new Error(`media: no record ${id}`);
    // Blob + identity fields are immutable; ignore any attempt to change them.
    const next: MediaCaptureRecord = {
      ...r,
      ...patch,
      id: r.id,
      workspaceId: r.workspaceId,
      kind: r.kind,
      mimeType: r.mimeType,
      byteSize: r.byteSize,
    };
    this.records.set(id, next);
    return { ...next };
  }
  async archive(id: string): Promise<void> {
    const r = this.records.get(id);
    if (!r) throw new Error(`media: no record ${id}`);
    this.records.set(id, { ...r, status: "archived", archivedAt: "1970-01-01T00:00:00.000Z" });
  }
}

export class InMemorySkillRegistry implements SkillRegistry {
  readonly skills = new Map<string, Skill>();
  register(skill: Skill): this {
    this.skills.set(skill.name, skill);
    return this;
  }
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }
}

/** Records observations; the real adjuster writes policy_params (P5). */
export class RecordingVarianceAdjuster implements VarianceAdjuster {
  readonly observed: LedgerEntry[] = [];
  async observe(entry: LedgerEntry, _ctx: RunCtx): Promise<void> {
    this.observed.push(entry);
  }
}

export class InMemoryRitualRegistry implements RitualRegistry {
  readonly rituals = new Map<string, RitualDefinition>();
  register(def: RitualDefinition): this {
    this.rituals.set(`${def.workspaceId}:${def.id}`, def);
    return this;
  }
  async load(workspaceId: string, ritualId: string): Promise<RitualDefinition | null> {
    return this.rituals.get(`${workspaceId}:${ritualId}`) ?? null;
  }
}

export class InMemoryToolRegistry implements ToolRegistry {
  readonly tools = new Map<string, RitualDefinition>();
  register(def: RitualDefinition): this {
    this.tools.set(`${def.workspaceId}:${def.id}`, def);
    return this;
  }
  async load(workspaceId: string, toolId: string): Promise<RitualDefinition | null> {
    return this.tools.get(`${workspaceId}:${toolId}`) ?? null;
  }
}

interface RunRecord {
  runId: string;
  ritualId: string;
  workspaceId: string;
  actorId: string;
  status: "running" | "completed" | "halted";
  output: unknown;
}

export class InMemoryRitualRunRecorder implements RitualRunRecorder {
  readonly runs = new Map<string, RunRecord>();
  async start(
    run: { runId: string; ritualId: string; workspaceId: string; actorId: string },
    _ctx: RunCtx,
  ): Promise<void> {
    this.runs.set(run.runId, { ...run, status: "running", output: null });
  }
  async finish(
    run: { runId: string; status: "completed" | "halted"; output: unknown },
    _ctx: RunCtx,
  ): Promise<void> {
    const existing = this.runs.get(run.runId);
    if (existing) {
      existing.status = run.status;
      existing.output = run.output;
    }
  }
}
