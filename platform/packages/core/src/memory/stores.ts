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
  ModelProvider,
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
import { AlreadyResolvedError } from "../pipeline.js";

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
  /** Owning workspace per agent (AgentQuery.workspaceId — added alongside
   * relationship-module trust boundaries; unset = unknown, never guessed). */
  readonly workspaces = new Map<string, string>();
  /** Active/inactive per agent (AgentQuery.isActive). Unset defaults to
   * INACTIVE (fail closed — an agent must be explicitly seeded active, mirrors
   * `DrizzleAgentStore.isActive`'s real-row-or-false shape, never assumes). */
  readonly statuses = new Map<string, "active" | "inactive">();

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
  async workspaceId(agentId: string): Promise<string | null> {
    return this.workspaces.get(agentId) ?? null;
  }
  async isActive(agentId: string): Promise<boolean> {
    return this.statuses.get(agentId) === "active";
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
    // Prune on write too (not just on read) so a long-running process that mints
    // grants faster than it queries them still gets bounded periodically.
    this.#pruneExpired(new Date().toISOString());
    this.grants.push({
      ...grant,
      actorKey: InMemoryRoleStore.key(actor),
      ...(contextId ? { contextId } : {}),
      expiresAtISO,
      consumed: false,
    });
  }

  /**
   * Lazily drop grants that have already expired, keyed off the same "now" every
   * read/write uses. This is a dev/pilot-only store (no `DATABASE_URL`) — grants
   * are minted continually and, without this, `this.grants` grows without bound
   * for the lifetime of a long-running local process even though every entry
   * past its `expiresAtISO` is permanently unobservable via `activeGrants()`.
   * A background sweep (setInterval) was considered and rejected: it would need
   * explicit teardown to avoid keeping test processes alive, for a store whose
   * only consumers are `mint()` and `activeGrants()` — pruning on every touch is
   * simpler and just as effective since nothing reads expired grants anyway.
   */
  #pruneExpired(nowISO: string): void {
    const now = Date.parse(nowISO);
    for (let i = this.grants.length - 1; i >= 0; i--) {
      const g = this.grants[i];
      if (g && Date.parse(g.expiresAtISO) <= now) {
        this.grants.splice(i, 1);
      }
    }
  }

  async activeGrants(
    _ws: string,
    actor: Actor,
    context: RunContext | undefined,
    nowISO: string,
  ): Promise<GrantRule[]> {
    this.#pruneExpired(nowISO);
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
  /**
   * Tracks proposal ids that already have a resolving (non-null userDecision)
   * decision row, so `append()` can check-and-mark atomically. `append()` is
   * declared `async` for interface parity with the Drizzle-backed store, but its
   * body contains no `await` before the mark — the check and the mark happen in
   * the SAME synchronous block, in the SAME microtask/turn of the JS event loop.
   * Two "concurrent" callers (e.g. `Promise.all([decide(), decide()])` in a test)
   * still each get their own microtask, but since neither one yields control
   * between the check and the mark, the second call to reach this method always
   * observes the first's mark — closing the double-approve TOCTOU for the
   * in-memory ledger the same way the persistent ledger's partial unique index
   * closes it for Postgres/pglite.
   */
  readonly #resolved = new Set<string>();

  async append(entry: LedgerEntry): Promise<LedgerEntry> {
    // Append-only: enforce no duplicate id, never overwrite.
    if (this.entries.some((e) => e.id === entry.id)) {
      throw new Error(`ledger: duplicate id ${entry.id} (append-only violation)`);
    }
    // Atomic check-and-mark: a resolving decision row (non-null userDecision,
    // referencing a proposal) may only be appended once per ref_ledger_id. No
    // `await` occurs between the check and the mark below, so this is race-free
    // within a single Node.js process/event loop.
    if (entry.refLedgerId && entry.userDecision !== null) {
      if (this.#resolved.has(entry.refLedgerId)) {
        throw new AlreadyResolvedError(entry.refLedgerId);
      }
      this.#resolved.add(entry.refLedgerId);
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
  async listPending(
    workspaceId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: LedgerEntry[]; total: number }> {
    const pending = this.entries
      .filter(
        (entry) =>
          entry.workspaceId === workspaceId &&
          entry.userDecision === null &&
          entry.refLedgerId === undefined &&
          !(
            typeof entry.diff === "object" &&
            entry.diff !== null &&
            !Array.isArray(entry.diff) &&
            "rejected" in entry.diff
          ) &&
          !this.#resolved.has(entry.id),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items: pending.slice(opts.offset, opts.offset + opts.limit), total: pending.length };
  }
}

/**
 * Retained-events cap for `InMemoryEventBus`. The `EventBus` port
 * (`ports.ts`) exposes only `emit()` — no query/replay method — so nothing in
 * `@bridge/core` ever reads `events` back out for historical replay; it exists
 * for local inspection/debugging in the dev/pilot (no-`DATABASE_URL`) path.
 * That means a ring buffer (keep the most recent N, drop oldest) is the
 * correct fit, not a time-window: there's no "replay the last 24h" consumer to
 * satisfy, just "don't grow forever." See docs/raw/decisions-log.md.
 */
const EVENT_BUS_MAX_EVENTS = 10_000;

export class InMemoryEventBus implements EventBus {
  readonly events: DomainEvent[] = [];
  async emit(event: DomainEvent): Promise<void> {
    this.events.push(event);
    if (this.events.length > EVENT_BUS_MAX_EVENTS) {
      // Drop oldest first — ring-buffer semantics via a bulk splice rather than
      // one shift() per overflow event (cheaper: O(overflow) not O(1) per call
      // once at cap, but still amortized O(1) since we only trim what's over).
      this.events.splice(0, this.events.length - EVENT_BUS_MAX_EVENTS);
    }
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

/**
 * Echo test double for `ModelProvider` — no network, deterministic. Lets
 * in-memory mode (and any test) exercise a model-shaped seam without pulling
 * in @bridge/models. Mirrors the `system`/`prompt` back so assertions can
 * check request-shaping without a real model call. `plane` defaults to
 * "local" (the safe default for capture/sensor-plane work); pass "cloud" to
 * simulate a cloud-bound provider in tests that need to exercise plane gating.
 */
export class EchoModelProvider implements ModelProvider {
  readonly id: string;
  readonly plane: "local" | "cloud";
  constructor(id = "echo", plane: "local" | "cloud" = "local") {
    this.id = id;
    this.plane = plane;
  }
  async complete(req: { system?: string; prompt: string; maxTokens?: number }): Promise<{ text: string }> {
    return { text: req.system ? `${req.system}\n${req.prompt}` : req.prompt };
  }
  async embed(texts: string[]): Promise<number[][]> {
    // Deterministic pseudo-embedding: vector of char-code sums, fixed length 8.
    return texts.map((t) => {
      const v = new Array(8).fill(0);
      for (let i = 0; i < t.length; i++) v[i % 8] += t.charCodeAt(i);
      return v;
    });
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
  async save(def: RitualDefinition): Promise<void> {
    if (!def.agentId) throw new Error("RitualRegistry.save: owning agentId is required");
    if (!def.agentPlane) throw new Error("RitualRegistry.save: owning agentPlane is required");
    this.register(def);
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
