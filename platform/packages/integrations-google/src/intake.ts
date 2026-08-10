/**
 * IntakeService — the READ pipeline: source → match → propose (capture ≠ commit).
 *
 *   1. An EGRESS agent (cloud plane) sources threads/events through the gate
 *      (external:fetch). The user's "Sync" click authorizes that inbound crossing,
 *      so the service approves it; the source skill has already cached the raw
 *      bodies to the LOCAL plane.
 *   2. For each captured item the LOCAL intake agent matches participants to People
 *      by email and PROPOSES graph entries (draft-then-approve):
 *        - exactly one match  → Interaction Event linked to that Person
 *        - many matches       → possible_duplicate Signal (NEVER auto-linked)
 *        - no match           → new counterparty identity + Interaction Event
 *   3. The user approves in the Approvals inbox; IntakeMaterializer commits the
 *      entries to the LOCAL graph. Shared owner-scoped Relationship Records are
 *      materialized by the API from the same governed decision.
 */
import {
  hashTaintValue,
  joinTaintLabels,
  labelFromLegacyTrustOrigin,
  labelAtSource,
  legacyTrustOriginFromLabel,
  type GoalTaskStore,
  type LedgerEntry,
  type LedgerStore,
  type Proposal,
  type ProposalStatus,
  type ResourceType,
  type RunCtx,
  type TaintLabel,
  type TrustOrigin,
  type UniversalActionPipeline,
} from "@bridge/core";
import type { BodyStore, LocalGraphStore } from "@bridge/local";
import {
  CALENDAR_SOURCE,
  GMAIL_SOURCE,
  type CalendarEvent,
  type EmailAddress,
  type GmailThread,
} from "./contracts.js";
import { GOOGLE_MANIFEST } from "./manifest.js";
import { SKILL_SOURCE_CALENDAR, SKILL_SOURCE_GMAIL, SKILL_STAGE } from "./skills.js";

// ── Materialization directive (carried in the proposal, applied on approval) ────

export interface PersonDirective {
  localPersonId: string;
  /** Retained only for replaying proposals created before owner-scoped identity storage. */
  canonicalIdIfNew?: string;
  fullName?: string;
  emails: string[];
  dedupKey: string;
  company?: string;
}
export interface EntityDirective {
  localId: string;
  kind: "event" | "memory" | "signal";
  personId?: string;
  payload: unknown;
  /** PI-1 provenance of the ingested content. */
  trustOrigin?: TrustOrigin;
  taintLabel?: TaintLabel;
  source: string;
  sourceRecordId: string;
}
export interface ExternalDirective {
  source: string;
  sourceRecordId: string;
  entityType: string;
}
export interface IntakeDirective {
  /** Private identity to persist locally and in the owner's Relationship Module. */
  person?: PersonDirective;
  /** Local-only graph commits (Events / Memories / Signals). */
  entities: EntityDirective[];
  /** Idempotency rows so re-sync never double-commits. */
  external: ExternalDirective[];
}

// ── Service ────────────────────────────────────────────────────────────────────

export interface IntakeIdentities {
  organizationId: string;
  /** Cloud-plane agent that SOURCES (external:fetch). */
  egressAgentId: string;
  /** Local-plane agent that DRAFTS graph proposals. */
  intakeAgentId: string;
  /** The signed-in user the agents act on behalf of. */
  userId: string;
}

export interface SyncOpts {
  integrationId: string;
  identities: IntakeIdentities;
  /** The user's own email(s) — excluded from counterparty matching. */
  selfEmails: string[];
  maxResults?: number;
  query?: string;
  /** Calendar-only: RFC3339 bounds for syncCalendar. */
  timeMin?: string;
  timeMax?: string;
}

export type MatchOutcome = "linked" | "new" | "ambiguous";

export interface IntakeProposalSummary {
  proposalId: string;
  status: ProposalStatus;
  resourceType: ResourceType;
  sourceRecordId: string;
  match: MatchOutcome;
  /** Human label for the Approvals inbox. */
  resource: string;
}

export interface IntakeResult {
  source: string;
  sourced: number;
  fetchProposalId: string;
  proposals: IntakeProposalSummary[];
}

export interface IntakeServiceDeps {
  pipeline: UniversalActionPipeline;
  bodies: BodyStore;
  graph: Pick<LocalGraphStore, "findPeopleByEmail" | "hasExternal">;
  /** Durable source/identity reservations. Required by production wiring. */
  pendingLedger?: Pick<LedgerStore, "listPending">;
  /**
   * AGS1 (TASK-007 closure) — optional Goal/Task provisioning for the 3
   * governed skills this service invokes (`SKILL_SOURCE_GMAIL`,
   * `SKILL_SOURCE_CALENDAR`, `SKILL_STAGE`). Every call site already uses an
   * Agent actor (`egressAgentId`/`intakeAgentId`), never Human/Automation-
   * direct; this dependency only supplies the `goalTaskRef` a registered
   * `SkillManifest` requires. Omitted = unchanged behavior UNLESS the
   * embedding's pipeline has a manifest registered for these skill ids, in
   * which case omitting this will fail closed (by design — see
   * `provisionGoogleSyncTask`'s doc comment).
   */
  goalTasks?: GoalTaskStore;
}

/**
 * AGS1 (TASK-007 closure) — find-or-create the ONE durable `"google.sync"`
 * Goal for a organization (a Goal is a durable intended outcome, not reminted
 * per call) and mint one bounded Task per call, assigned to the Agent actually
 * invoking the skill. Shared by every governed Google skill call site in this
 * module (`syncGmail`/`syncCalendar`/`stage` here, `listCalendarEvents` in
 * service.ts) so they all resolve against the SAME Goal.
 */
export async function provisionGoogleSyncTask(
  goalTasks: GoalTaskStore | undefined,
  organizationId: string,
  taskType: string,
  assignedAgentId: string,
  ctx: RunCtx,
): Promise<{ goalId: string; taskId: string } | undefined> {
  if (!goalTasks) return undefined;
  const seam = { nextId: () => ctx.ids.next(), nowISO: () => ctx.clock.nowISO() };
  const existingGoals = await goalTasks.listGoals(organizationId);
  const goal =
    existingGoals.find((g) => g.type === "google.sync") ??
    (await goalTasks.createGoal({ organizationId, type: "google.sync", title: "Google Organization sync" }, seam));
  const task = await goalTasks.createTask({ organizationId, goalId: goal.id, type: taskType, assignedAgentId }, seam);
  return { goalId: goal.id, taskId: task.id };
}

function norm(email: string): string {
  return email.trim().toLowerCase();
}

function counterpartyOf(participants: EmailAddress[], selfEmails: string[]): EmailAddress | null {
  const self = new Set(selfEmails.map(norm));
  return participants.find((p) => !self.has(norm(p.email))) ?? null;
}

export class IntakeService {
  /** Fast cache backed by a bounded durable pending-ledger scan on every locked stage. */
  private readonly pendingSeeds = new Map<string, string>(); // seed -> proposalId
  private readonly stageLocks = new Map<string, Promise<void>>();

  constructor(private readonly deps: IntakeServiceDeps) {}

  /** Called once a staged proposal resolves (approved, vetoed, or edited) so the seed
   * is free to be re-proposed if the same external item is ever re-synced (e.g. after
   * a veto). See `GoogleService.onApproved`/decide call sites, which call this. */
  clearPendingSeed(seed: string | undefined): void {
    if (seed) this.pendingSeeds.delete(seed);
  }

  /** Source Gmail threads through the gate, then propose graph entries per thread. */
  async syncGmail(opts: SyncOpts, ctx: RunCtx): Promise<IntakeResult> {
    const { organizationId, egressAgentId, intakeAgentId, userId } = opts.identities;

    // 1) Source through the gate (cloud egress agent). The user's Sync click approves.
    const gmailGoalTaskRef = await provisionGoogleSyncTask(this.deps.goalTasks, organizationId, "source_google_data", egressAgentId, ctx);
    const fetchProposal = await this.deps.pipeline.propose(
      {
        organizationId,
        actor: { type: "agent", id: egressAgentId, plane: "cloud" },
        onBehalfOf: { type: "user", id: userId },
        action: "read",
        resourceType: "external:fetch",
        skill: SKILL_SOURCE_GMAIL,
        dataScope: "public",
        taintLabel: labelAtSource("system_generated", {
          ref: `${opts.integrationId}:gmail-sync`,
          valueHash: hashTaintValue({ organizationId, query: opts.query }),
          sensitivity: "public",
          instructionRisk: "none",
        }),
        inputs: {
          integrationId: opts.integrationId,
          organizationId,
          ...(opts.maxResults ? { maxResults: opts.maxResults } : {}),
          ...(opts.query ? { query: opts.query } : {}),
        },
        ...(gmailGoalTaskRef ? { goalTaskRef: gmailGoalTaskRef } : {}),
      },
      ctx,
    );
    if (fetchProposal.status === "rejected") {
      throw new Error(`gmail source rejected at the gate: ${fetchProposal.rejectionReason ?? "unknown"}`);
    }
    if (fetchProposal.status === "pending_review") {
      // The user's Sync click authorizes this inbound crossing — they are the approver.
      await this.deps.pipeline.decide(fetchProposal.id, "approve", { type: "user", id: userId }, ctx);
    }

    const manifest = (fetchProposal.output?.proposedOutput as { threads?: { threadId: string }[] } | undefined)?.threads ?? [];
    const proposals: IntakeProposalSummary[] = [];

    for (const m of manifest) {
      if (await this.deps.graph.hasExternal(organizationId, GMAIL_SOURCE, m.threadId)) continue;
      const body = await this.deps.bodies.get(organizationId, GMAIL_SOURCE, m.threadId);
      if (!body) continue;
      const thread = body.content as GmailThread;
      const summary = await this.proposeThread(thread, opts, ctx);
      proposals.push(summary);
    }

    return { source: GMAIL_SOURCE, sourced: manifest.length, fetchProposalId: fetchProposal.id, proposals };
  }

  /** Source Calendar events through the gate, then propose an Interaction Event per item. */
  async syncCalendar(opts: SyncOpts, ctx: RunCtx): Promise<IntakeResult> {
    const { organizationId, egressAgentId, intakeAgentId, userId } = opts.identities;
    const calendarGoalTaskRef = await provisionGoogleSyncTask(this.deps.goalTasks, organizationId, "source_google_data", egressAgentId, ctx);
    const fetchProposal = await this.deps.pipeline.propose(
      {
        organizationId,
        actor: { type: "agent", id: egressAgentId, plane: "cloud" },
        onBehalfOf: { type: "user", id: userId },
        action: "read",
        resourceType: "external:fetch",
        skill: SKILL_SOURCE_CALENDAR,
        dataScope: "public",
        taintLabel: labelAtSource("system_generated", {
          ref: `${opts.integrationId}:calendar-sync`,
          valueHash: hashTaintValue({
            organizationId,
            timeMin: opts.timeMin,
            timeMax: opts.timeMax,
          }),
          sensitivity: "public",
          instructionRisk: "none",
        }),
        inputs: {
          integrationId: opts.integrationId,
          organizationId,
          ...(opts.maxResults ? { maxResults: opts.maxResults } : {}),
          ...(opts.timeMin ? { timeMin: opts.timeMin } : {}),
          ...(opts.timeMax ? { timeMax: opts.timeMax } : {}),
        },
        ...(calendarGoalTaskRef ? { goalTaskRef: calendarGoalTaskRef } : {}),
      },
      ctx,
    );
    if (fetchProposal.status === "rejected") {
      throw new Error(`calendar source rejected at the gate: ${fetchProposal.rejectionReason ?? "unknown"}`);
    }
    if (fetchProposal.status === "pending_review") {
      // The user's Sync click authorizes this inbound crossing — they are the approver.
      await this.deps.pipeline.decide(fetchProposal.id, "approve", { type: "user", id: userId }, ctx);
    }

    const manifest = (fetchProposal.output?.proposedOutput as { events?: { eventId: string }[] } | undefined)?.events ?? [];
    const proposals: IntakeProposalSummary[] = [];

    for (const m of manifest) {
      if (await this.deps.graph.hasExternal(organizationId, CALENDAR_SOURCE, m.eventId)) continue;
      const body = await this.deps.bodies.get(organizationId, CALENDAR_SOURCE, m.eventId);
      if (!body) continue;
      const event = body.content as CalendarEvent;
      const summary = await this.proposeEvent(event, opts, ctx);
      proposals.push(summary);
    }

    return { source: CALENDAR_SOURCE, sourced: manifest.length, fetchProposalId: fetchProposal.id, proposals };
  }

  private async proposeThread(thread: GmailThread, opts: SyncOpts, ctx: RunCtx): Promise<IntakeProposalSummary> {
    const { organizationId, intakeAgentId, userId } = opts.identities;
    const cp = counterpartyOf(thread.participants, opts.selfEmails);
    const matches = cp ? await this.deps.graph.findPeopleByEmail(organizationId, cp.email) : [];

    if (cp && matches.length > 1) {
      // AMBIGUOUS — never auto-link. File a possible_duplicate Signal for manual cleanup.
      return this.stage(
        {
          organizationId,
          intakeAgentId,
          userId,
          resourceType: "signal",
          resource: cp.name ?? cp.email,
          channel: "Email",
          match: "ambiguous",
          sourceRecordId: thread.threadId,
          directive: {
            entities: [
              {
                localId: ctx.ids.next(),
                kind: "signal",
                payload: {
                  type: "possible_duplicate",
                  reason: "email matches multiple people",
                  email: cp.email,
                  candidates: matches.map((p) => ({ id: p.id, name: p.fullName })),
                  subject: thread.subject,
                },
                source: GMAIL_SOURCE,
                sourceRecordId: thread.threadId,
              },
            ],
            external: [{ source: GMAIL_SOURCE, sourceRecordId: thread.threadId, entityType: "signal" }],
          },
          trace: {
            signals: ["email matched >1 person — manual confirmation needed"],
            context: `Thread "${thread.subject}" from ${cp.email}`,
            reasoning: "Uncertain person-match: filed a possible_duplicate Signal instead of auto-linking.",
          },
        },
        ctx,
      );
    }

    const matched = matches[0];
    const newPerson = !matched && cp ? this.newPersonDirective(cp, ctx) : undefined;
    const personId = matched?.id ?? newPerson?.localPersonId;

    const eventId = ctx.ids.next();
    const memoryId = ctx.ids.next();
    const lastMsg = thread.messages[thread.messages.length - 1];
    const gmailTrustOrigin: TrustOrigin = GOOGLE_MANIFEST.intake_policy.quarantine ? "untrusted_external" : "user_content";
    const gmailTaintLabel = labelAtSource("email_google_intake", {
      ref: `${GMAIL_SOURCE}:${thread.threadId}`,
      valueHash: hashTaintValue(thread),
      sensitivity: "private",
      instructionRisk: "instruction_like",
    });

    const directive: IntakeDirective = {
      ...(newPerson ? { person: newPerson } : {}),
      entities: [
        {
          localId: eventId,
          kind: "event",
          ...(personId ? { personId } : {}),
          payload: {
            interactionKind: "email",
            subject: thread.subject,
            occurredAt: thread.lastMessageAt,
            with: cp?.email ?? null,
            snippet: thread.snippet,
          },
          source: GMAIL_SOURCE,
          sourceRecordId: thread.threadId,
          trustOrigin: gmailTrustOrigin,
          taintLabel: gmailTaintLabel,
        },
        {
          localId: memoryId,
          kind: "memory",
          ...(personId ? { personId } : {}),
          payload: {
            title: thread.subject,
            summary: thread.snippet,
            body: lastMsg?.bodyText ?? "",
            occurredAt: thread.lastMessageAt,
          },
          trustOrigin: gmailTrustOrigin,
          taintLabel: gmailTaintLabel,
          source: GMAIL_SOURCE,
          sourceRecordId: thread.threadId,
        },
      ],
      external: [{ source: GMAIL_SOURCE, sourceRecordId: thread.threadId, entityType: "event" }],
    };

    return this.stage(
      {
        organizationId,
        intakeAgentId,
        userId,
        resourceType: "event",
        resource: cp?.name ?? cp?.email ?? thread.subject,
        channel: "Email",
        match: matched ? "linked" : "new",
        sourceRecordId: thread.threadId,
        directive,
        trace: {
          signals: [matched ? "matched an existing Person by email" : "new counterparty (identity dual-write)"],
          context: `Email thread "${thread.subject}" with ${cp?.email ?? "unknown"}`,
          reasoning: "Drafted an Interaction Event + Memory from a sourced Gmail thread for review.",
        },
      },
      ctx,
    );
  }

  private async proposeEvent(event: CalendarEvent, opts: SyncOpts, ctx: RunCtx): Promise<IntakeProposalSummary> {
    const { organizationId, intakeAgentId, userId } = opts.identities;
    const cp = counterpartyOf(event.attendees, opts.selfEmails);
    const matches = cp ? await this.deps.graph.findPeopleByEmail(organizationId, cp.email) : [];
    const calendarTaintLabel = labelAtSource("email_google_intake", {
      ref: `${CALENDAR_SOURCE}:${event.eventId}`,
      valueHash: hashTaintValue(event),
      sensitivity: "private",
      instructionRisk: "instruction_like",
    });

    if (cp && matches.length > 1) {
      return this.stage(
        {
          organizationId,
          intakeAgentId,
          userId,
          resourceType: "signal",
          resource: cp.name ?? cp.email,
          channel: "Calendar",
          match: "ambiguous",
          sourceRecordId: event.eventId,
          directive: {
            entities: [
              {
                localId: ctx.ids.next(),
                kind: "signal",
                payload: {
                  type: "possible_duplicate",
                  reason: "attendee matches multiple people",
                  email: cp.email,
                  candidates: matches.map((p) => ({ id: p.id, name: p.fullName })),
                  summary: event.summary,
                },
                source: CALENDAR_SOURCE,
                sourceRecordId: event.eventId,
                trustOrigin: "untrusted_external",
                taintLabel: calendarTaintLabel,
              },
            ],
            external: [{ source: CALENDAR_SOURCE, sourceRecordId: event.eventId, entityType: "signal" }],
          },
          trace: {
            signals: ["attendee matched >1 person — manual confirmation needed"],
            context: `Event "${event.summary}" with ${cp.email}`,
            reasoning: "Uncertain person-match: filed a possible_duplicate Signal instead of auto-linking.",
          },
        },
        ctx,
      );
    }

    const matched = matches[0];
    const newPerson = !matched && cp ? this.newPersonDirective(cp, ctx) : undefined;
    const personId = matched?.id ?? newPerson?.localPersonId;

    const directive: IntakeDirective = {
      ...(newPerson ? { person: newPerson } : {}),
      entities: [
        {
          localId: ctx.ids.next(),
          kind: "event",
          ...(personId ? { personId } : {}),
          payload: {
            interactionKind: "meeting",
            subject: event.summary,
            occurredAt: event.start,
            with: cp?.email ?? null,
            location: event.location ?? null,
            // K5 (TASK-049): the invite list is interaction metadata the
            // approved graph row (and the capture signal derived from it)
            // legitimately carries. Emails only — never the description.
            attendees: event.attendees.map((attendee) => attendee.email),
          },
          source: CALENDAR_SOURCE,
          sourceRecordId: event.eventId,
          trustOrigin: "untrusted_external",
          taintLabel: calendarTaintLabel,
        },
      ],
      external: [{ source: CALENDAR_SOURCE, sourceRecordId: event.eventId, entityType: "event" }],
    };

    return this.stage(
      {
        organizationId,
        intakeAgentId,
        userId,
        resourceType: "event",
        resource: cp?.name ?? cp?.email ?? event.summary,
        channel: "Calendar",
        match: matched ? "linked" : "new",
        sourceRecordId: event.eventId,
        directive,
        trace: {
          signals: [matched ? "matched an existing Person by email" : "new counterparty (identity dual-write)"],
          context: `Calendar event "${event.summary}" with ${cp?.email ?? "unknown"}`,
          reasoning: "Drafted an Interaction Event from a sourced Calendar item for review.",
        },
      },
      ctx,
    );
  }

  private newPersonDirective(cp: EmailAddress, ctx: RunCtx): PersonDirective {
    return {
      localPersonId: ctx.ids.next(),
      ...(cp.name ? { fullName: cp.name } : {}),
      emails: [cp.email],
      dedupKey: norm(cp.email),
    };
  }

  private async stage(
    args: {
      organizationId: string;
      intakeAgentId: string;
      userId: string;
      resourceType: ResourceType;
      resource: string;
      channel: string;
      match: MatchOutcome;
      sourceRecordId: string;
      directive: IntakeDirective;
      trace: { signals: string[]; context: string; reasoning: string };
    },
    ctx: RunCtx,
  ): Promise<IntakeProposalSummary> {
    const seed = `${args.directive.external[0]?.source}:${args.sourceRecordId}`;
    const lockKey =
      `${args.organizationId}:${args.userId}:${args.directive.person?.dedupKey ?? seed}`;
    return this.withStageLock(lockKey, () => this.stageLocked(args, seed, ctx));
  }

  private async stageLocked(
    args: {
      organizationId: string;
      intakeAgentId: string;
      userId: string;
      resourceType: ResourceType;
      resource: string;
      channel: string;
      match: MatchOutcome;
      sourceRecordId: string;
      directive: IntakeDirective;
      trace: { signals: string[]; context: string; reasoning: string };
    },
    seed: string,
    ctx: RunCtx,
  ): Promise<IntakeProposalSummary> {
    let directive = args.directive;
    const taintLabel = joinTaintLabels(
      ...directive.entities.map(
        (entity) =>
          entity.taintLabel ??
          labelFromLegacyTrustOrigin(
            entity.trustOrigin,
            `${entity.source}:${entity.sourceRecordId}`,
          ),
      ),
    );
    const trustOrigin = legacyTrustOriginFromLabel(taintLabel);
    const pending = await this.pendingIntakeEntries(args.organizationId, args.userId);
    const existingPendingId =
      pending.find((entry) => entry.seed === seed)?.id ??
      this.pendingSeeds.get(seed);
    if (existingPendingId) {
      return {
        proposalId: existingPendingId,
        status: "pending_review",
        resourceType: args.resourceType,
        sourceRecordId: args.sourceRecordId,
        match: args.match,
        resource: args.resource,
      };
    }

    const requestedPerson = directive.person;
    if (requestedPerson) {
      const reserved = pending
        .map((entry) => this.intakeDirective(entry))
        .find((candidate) => candidate?.person?.dedupKey === requestedPerson.dedupKey)
        ?.person;
      if (reserved) {
        directive = {
          ...directive,
          person: reserved,
          entities: directive.entities.map((entity) =>
            entity.personId === requestedPerson.localPersonId
              ? { ...entity, personId: reserved.localPersonId }
              : entity
          ),
        };
      }
    }

    const stageGoalTaskRef = await provisionGoogleSyncTask(this.deps.goalTasks, args.organizationId, "stage_google_data", args.intakeAgentId, ctx);
    const proposal = await this.deps.pipeline.propose(
      {
        organizationId: args.organizationId,
        actor: { type: "agent", id: args.intakeAgentId, plane: "local" },
        onBehalfOf: { type: "user", id: args.userId },
        action: "write",
        resourceType: args.resourceType,
        skill: SKILL_STAGE,
        dataScope: "private",
        seed,
        trustOrigin,
        taintLabel,
        inputs: {
          directive,
          display: {
            actor: "Inbox Intake Agent",
            actorKind: "agent",
            onBehalfOf: "You",
            resource: args.resource,
            policy: "intake review",
            channel: args.channel,
            prior: null,
            trace: args.trace,
          },
        },
        ...(stageGoalTaskRef ? { goalTaskRef: stageGoalTaskRef } : {}),
      },
      ctx,
    );
    if (proposal.status === "pending_review") {
      this.pendingSeeds.set(seed, proposal.id);
    }
    return {
      proposalId: proposal.id,
      status: proposal.status,
      resourceType: args.resourceType,
      sourceRecordId: args.sourceRecordId,
      match: args.match,
      resource: args.resource,
    };
  }

  private async pendingIntakeEntries(
    organizationId: string,
    ownerUserId: string,
  ): Promise<LedgerEntry[]> {
    if (!this.deps.pendingLedger) return [];
    const rows: LedgerEntry[] = [];
    const pageSize = 100;
    const maxRows = 1_000;
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const page = await this.deps.pendingLedger.listPending(organizationId, {
        limit: pageSize,
        offset,
        privateOwnerUserId: ownerUserId,
      });
      rows.push(...page.items);
      if (rows.length >= page.total) return rows;
    }
    throw new Error(
      "Google intake cannot safely reserve an identity while more than 1,000 proposals await review",
    );
  }

  private intakeDirective(entry: LedgerEntry): IntakeDirective | null {
    if (
      typeof entry.inputs !== "object" ||
      entry.inputs === null ||
      Array.isArray(entry.inputs) ||
      !("directive" in entry.inputs)
    ) {
      return null;
    }
    const directive = (entry.inputs as { directive?: IntakeDirective }).directive;
    return directive &&
      Array.isArray(directive.entities) &&
      Array.isArray(directive.external)
      ? directive
      : null;
  }

  private async withStageLock<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.stageLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(() => gate);
    this.stageLocks.set(key, current);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (this.stageLocks.get(key) === current) this.stageLocks.delete(key);
    }
  }
}

// ── Materializer (post-approval commit) ─────────────────────────────────────────

export interface IntakeMaterializerDeps {
  graph: LocalGraphStore;
}

/** Bounded retries for a TRANSIENT local persistence failure. Every step
 * `applyApproved` performs is idempotent (upsertPerson: ON CONFLICT DO UPDATE;
 * commitEntity: ON CONFLICT DO NOTHING;
 * recordExternal: ON CONFLICT DO NOTHING), so retrying the whole method from scratch
 * is safe and far simpler than per-step retry logic. */
async function withRetry<T>(label: string, attempts: number, delayMs: number, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      console.error(`${label}: attempt ${attempt} failed, retrying — ${(err as Error)?.message ?? err}`, err);
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastErr;
}

export class IntakeMaterializer {
  constructor(private readonly deps: IntakeMaterializerDeps) {}

  /** Apply a resolved (approved/edited) intake proposal to the LOCAL graph.
   * Returns true if it was a Google intake proposal (and was applied), false otherwise.
   *
   * The dual-write body is retried (bounded, idempotent) on transient failure —
   * see withRetry above. */
  async applyApproved(resolved: Proposal, ctx: RunCtx): Promise<boolean> {
    const out = resolved.output?.proposedOutput as { directive?: IntakeDirective } | undefined;
    const directive = out?.directive;
    if (!directive) return false;

    return withRetry(`IntakeMaterializer.applyApproved(${resolved.id})`, 3, 25, () =>
      this.applyDirective(directive, resolved, ctx),
    );
  }

  private async applyDirective(directive: IntakeDirective, resolved: Proposal, ctx: RunCtx): Promise<boolean> {
    const organizationId = resolved.request.organizationId;
    const createdAt = ctx.clock.nowISO();

    if (directive.person) {
      const p = directive.person;
      await this.deps.graph.upsertPerson({
        id: p.localPersonId,
        organizationId,
        ...(p.fullName ? { fullName: p.fullName } : {}),
        emails: p.emails,
      });
    }

    for (const e of directive.entities) {
      await this.deps.graph.commitEntity({
        id: e.localId,
        organizationId,
        kind: e.kind,
        ...(e.personId ? { personId: e.personId } : {}),
        payload: e.payload,
        source: e.source,
        sourceRecordId: e.sourceRecordId,
        createdAt,
      });
    }
    for (const x of directive.external) {
      await this.deps.graph.recordExternal({
        organizationId,
        source: x.source,
        sourceRecordId: x.sourceRecordId,
        entityType: x.entityType,
        entityId: directive.entities[0]?.localId ?? x.sourceRecordId,
        createdAt,
      });
    }
    return true;
  }
}
