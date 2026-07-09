/**
 * IntakeService — the READ pipeline: source → match → propose (capture ≠ commit).
 *
 *   1. An EGRESS agent (cloud plane) sources threads/events through the gate
 *      (external:fetch). The user's "Sync" click authorizes that inbound crossing,
 *      so the service approves it; the source skill has already cached the raw
 *      bodies to the LOCAL plane.
 *   2. For each captured item the LOCAL intake agent matches participants to People
 *      by email and PROPOSES graph entries (draft-then-approve):
 *        - exactly one match  → Touchpoint linked to that Person
 *        - many matches       → possible_duplicate Signal (NEVER auto-linked)
 *        - no match           → new counterparty identity + Touchpoint
 *   3. The user approves in the Approvals inbox; IntakeMaterializer commits the
 *      entries to the LOCAL graph and dual-writes ONLY the public identity to cloud
 *      canonical. Every step is append-only audited in the (local) ledger.
 */
import type { Proposal, ProposalStatus, ResourceType, RunCtx, UniversalActionPipeline } from "@bridge/core";
import type { BodyStore, LocalGraphStore } from "@bridge/local";
import type { CanonicalIdentityStore } from "@bridge/db";
import {
  CALENDAR_SOURCE,
  GMAIL_SOURCE,
  type CalendarEvent,
  type EmailAddress,
  type GmailThread,
} from "./contracts.js";
import { SKILL_SOURCE_CALENDAR, SKILL_SOURCE_GMAIL, SKILL_STAGE } from "./skills.js";

// ── Materialization directive (carried in the proposal, applied on approval) ────

export interface PersonDirective {
  localPersonId: string;
  /** Canonical id to use if the identity is new (caller-minted, replayable). */
  canonicalIdIfNew: string;
  fullName?: string;
  emails: string[];
  dedupKey: string;
  company?: string;
}
export interface EntityDirective {
  localId: string;
  kind: "touchpoint" | "memory" | "signal";
  personId?: string;
  payload: unknown;
  source: string;
  sourceRecordId: string;
}
export interface ExternalDirective {
  source: string;
  sourceRecordId: string;
  entityType: string;
}
export interface IntakeDirective {
  /** Public identity to dual-write (cloud canonical + local). The ONLY outward fact. */
  person?: PersonDirective;
  /** Local-only graph commits (Touchpoints / Memories / Signals). */
  entities: EntityDirective[];
  /** Idempotency rows so re-sync never double-commits. */
  external: ExternalDirective[];
}

// ── Service ────────────────────────────────────────────────────────────────────

export interface IntakeIdentities {
  workspaceId: string;
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
  graph: LocalGraphStore;
}

function norm(email: string): string {
  return email.trim().toLowerCase();
}

function counterpartyOf(participants: EmailAddress[], selfEmails: string[]): EmailAddress | null {
  const self = new Set(selfEmails.map(norm));
  return participants.find((p) => !self.has(norm(p.email))) ?? null;
}

export class IntakeService {
  /**
   * Propose-time dedup: `graph.hasExternal` (checked below) only excludes items that
   * have already been MATERIALIZED (i.e. an approved proposal has committed). It does
   * NOT see proposals that are staged but still `pending_review` in the Approvals
   * inbox. Without this, running syncGmail/syncCalendar twice before the user gets to
   * the inbox stages a second PENDING proposal for the same thread/event, and if both
   * are later approved you get duplicate Touchpoints/Memories (no dedup key on the
   * entities themselves at commit time).
   *
   * `@bridge/core`'s `LedgerStore`/`UniversalActionPipeline` expose no query surface
   * for "list pending proposals by seed" (only `get(id)` / `decisionFor(proposalId)`),
   * and `IntakeServiceDeps` is intentionally narrow (pipeline/bodies/graph only) — so
   * this tracks in-process which (source, sourceRecordId) seeds currently have an
   * unresolved PENDING proposal outstanding, keyed by the same `seed` string already
   * passed to `pipeline.propose()` (`stage()` below). Entries are added when `stage()`
   * returns `pending_review` and removed once `IntakeMaterializer.applyApproved`
   * resolves that seed (see `IntakeMaterializer#clearPendingSeed` wiring) — so the
   * window this closes is exactly the "two syncs before approval" race described above.
   * Scoped to this file/package only; no core change.
   */
  private readonly pendingSeeds = new Map<string, string>(); // seed -> proposalId

  constructor(private readonly deps: IntakeServiceDeps) {}

  /** Called once a staged proposal resolves (approved, vetoed, or edited) so the seed
   * is free to be re-proposed if the same external item is ever re-synced (e.g. after
   * a veto). See `GoogleService.onApproved`/decide call sites, which call this. */
  clearPendingSeed(seed: string | undefined): void {
    if (seed) this.pendingSeeds.delete(seed);
  }

  /** Source Gmail threads through the gate, then propose graph entries per thread. */
  async syncGmail(opts: SyncOpts, ctx: RunCtx): Promise<IntakeResult> {
    const { workspaceId, egressAgentId, intakeAgentId, userId } = opts.identities;

    // 1) Source through the gate (cloud egress agent). The user's Sync click approves.
    const fetchProposal = await this.deps.pipeline.propose(
      {
        workspaceId,
        actor: { type: "agent", id: egressAgentId, plane: "cloud" },
        onBehalfOf: { type: "user", id: userId },
        action: "read",
        resourceType: "external:fetch",
        skill: SKILL_SOURCE_GMAIL,
        dataScope: "public",
        inputs: {
          integrationId: opts.integrationId,
          workspaceId,
          ...(opts.maxResults ? { maxResults: opts.maxResults } : {}),
          ...(opts.query ? { query: opts.query } : {}),
        },
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
      if (await this.deps.graph.hasExternal(workspaceId, GMAIL_SOURCE, m.threadId)) continue;
      const body = await this.deps.bodies.get(workspaceId, GMAIL_SOURCE, m.threadId);
      if (!body) continue;
      const thread = body.content as GmailThread;
      const summary = await this.proposeThread(thread, opts, ctx);
      proposals.push(summary);
    }

    return { source: GMAIL_SOURCE, sourced: manifest.length, fetchProposalId: fetchProposal.id, proposals };
  }

  /** Source Calendar events through the gate, then propose a Touchpoint per event. */
  async syncCalendar(opts: SyncOpts, ctx: RunCtx): Promise<IntakeResult> {
    const { workspaceId, egressAgentId, intakeAgentId, userId } = opts.identities;
    const fetchProposal = await this.deps.pipeline.propose(
      {
        workspaceId,
        actor: { type: "agent", id: egressAgentId, plane: "cloud" },
        onBehalfOf: { type: "user", id: userId },
        action: "read",
        resourceType: "external:fetch",
        skill: SKILL_SOURCE_CALENDAR,
        dataScope: "public",
        inputs: {
          integrationId: opts.integrationId,
          workspaceId,
          ...(opts.maxResults ? { maxResults: opts.maxResults } : {}),
          ...(opts.timeMin ? { timeMin: opts.timeMin } : {}),
          ...(opts.timeMax ? { timeMax: opts.timeMax } : {}),
        },
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
      if (await this.deps.graph.hasExternal(workspaceId, CALENDAR_SOURCE, m.eventId)) continue;
      const body = await this.deps.bodies.get(workspaceId, CALENDAR_SOURCE, m.eventId);
      if (!body) continue;
      const event = body.content as CalendarEvent;
      const summary = await this.proposeEvent(event, opts, ctx);
      proposals.push(summary);
    }

    return { source: CALENDAR_SOURCE, sourced: manifest.length, fetchProposalId: fetchProposal.id, proposals };
  }

  private async proposeThread(thread: GmailThread, opts: SyncOpts, ctx: RunCtx): Promise<IntakeProposalSummary> {
    const { workspaceId, intakeAgentId, userId } = opts.identities;
    const cp = counterpartyOf(thread.participants, opts.selfEmails);
    const matches = cp ? await this.deps.graph.findPeopleByEmail(workspaceId, cp.email) : [];

    if (cp && matches.length > 1) {
      // AMBIGUOUS — never auto-link. File a possible_duplicate Signal for manual cleanup.
      return this.stage(
        {
          workspaceId,
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

    const touchpointId = ctx.ids.next();
    const memoryId = ctx.ids.next();
    const lastMsg = thread.messages[thread.messages.length - 1];

    const directive: IntakeDirective = {
      ...(newPerson ? { person: newPerson } : {}),
      entities: [
        {
          localId: touchpointId,
          kind: "touchpoint",
          ...(personId ? { personId } : {}),
          payload: {
            touchpointKind: "email",
            subject: thread.subject,
            occurredAt: thread.lastMessageAt,
            with: cp?.email ?? null,
            snippet: thread.snippet,
          },
          source: GMAIL_SOURCE,
          sourceRecordId: thread.threadId,
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
          source: GMAIL_SOURCE,
          sourceRecordId: thread.threadId,
        },
      ],
      external: [{ source: GMAIL_SOURCE, sourceRecordId: thread.threadId, entityType: "touchpoint" }],
    };

    return this.stage(
      {
        workspaceId,
        intakeAgentId,
        userId,
        resourceType: "touchpoint",
        resource: cp?.name ?? cp?.email ?? thread.subject,
        channel: "Email",
        match: matched ? "linked" : "new",
        sourceRecordId: thread.threadId,
        directive,
        trace: {
          signals: [matched ? "matched an existing Person by email" : "new counterparty (identity dual-write)"],
          context: `Email thread "${thread.subject}" with ${cp?.email ?? "unknown"}`,
          reasoning: "Drafted a Touchpoint + Memory from a sourced Gmail thread for review.",
        },
      },
      ctx,
    );
  }

  private async proposeEvent(event: CalendarEvent, opts: SyncOpts, ctx: RunCtx): Promise<IntakeProposalSummary> {
    const { workspaceId, intakeAgentId, userId } = opts.identities;
    const cp = counterpartyOf(event.attendees, opts.selfEmails);
    const matches = cp ? await this.deps.graph.findPeopleByEmail(workspaceId, cp.email) : [];

    if (cp && matches.length > 1) {
      return this.stage(
        {
          workspaceId,
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
          kind: "touchpoint",
          ...(personId ? { personId } : {}),
          payload: {
            touchpointKind: "meeting",
            subject: event.summary,
            occurredAt: event.start,
            with: cp?.email ?? null,
            location: event.location ?? null,
          },
          source: CALENDAR_SOURCE,
          sourceRecordId: event.eventId,
        },
      ],
      external: [{ source: CALENDAR_SOURCE, sourceRecordId: event.eventId, entityType: "touchpoint" }],
    };

    return this.stage(
      {
        workspaceId,
        intakeAgentId,
        userId,
        resourceType: "touchpoint",
        resource: cp?.name ?? cp?.email ?? event.summary,
        channel: "Calendar",
        match: matched ? "linked" : "new",
        sourceRecordId: event.eventId,
        directive,
        trace: {
          signals: [matched ? "matched an existing Person by email" : "new counterparty (identity dual-write)"],
          context: `Calendar event "${event.summary}" with ${cp?.email ?? "unknown"}`,
          reasoning: "Drafted a Touchpoint from a sourced Calendar event for review.",
        },
      },
      ctx,
    );
  }

  private newPersonDirective(cp: EmailAddress, ctx: RunCtx): PersonDirective {
    return {
      localPersonId: ctx.ids.next(),
      canonicalIdIfNew: ctx.ids.next(),
      ...(cp.name ? { fullName: cp.name } : {}),
      emails: [cp.email],
      dedupKey: norm(cp.email),
    };
  }

  private async stage(
    args: {
      workspaceId: string;
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

    // Propose-time dedup: a proposal for this exact external item is already sitting
    // PENDING in the Approvals inbox (staged by an earlier sync in this process). Don't
    // stage a second one — return the existing pending proposal's summary instead.
    const existingPendingId = this.pendingSeeds.get(seed);
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

    const proposal = await this.deps.pipeline.propose(
      {
        workspaceId: args.workspaceId,
        actor: { type: "agent", id: args.intakeAgentId, plane: "local" },
        onBehalfOf: { type: "user", id: args.userId },
        action: "write",
        resourceType: args.resourceType,
        skill: SKILL_STAGE,
        dataScope: "all",
        seed,
        inputs: {
          directive: args.directive,
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
}

// ── Materializer (post-approval commit) ─────────────────────────────────────────

export interface IntakeMaterializerDeps {
  graph: LocalGraphStore;
  canonical: CanonicalIdentityStore;
}

/** Bounded retries for a TRANSIENT failure in the dual-write (network blip, local
 * pglite hiccup). Every step `applyApproved` performs is idempotent (upsertPersonIdentity
 * / upsertPerson: ON CONFLICT DO UPDATE; commitEntity: ON CONFLICT DO NOTHING;
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
   * Dual-writes ONLY the public identity to cloud canonical. Returns true if it
   * was a Google intake proposal (and was applied), false otherwise.
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
    const workspaceId = resolved.request.workspaceId;
    const createdAt = ctx.clock.nowISO();

    if (directive.person) {
      const p = directive.person;
      const { canonicalPersonId } = await this.deps.canonical.upsertPersonIdentity(
        {
          dedupKey: p.dedupKey,
          ...(p.fullName ? { fullName: p.fullName } : {}),
          emails: p.emails,
          ...(p.company ? { currentCompanyName: p.company } : {}),
          enrichmentSource: "google",
        },
        p.canonicalIdIfNew,
      );
      await this.deps.graph.upsertPerson({
        id: p.localPersonId,
        workspaceId,
        ...(p.fullName ? { fullName: p.fullName } : {}),
        emails: p.emails,
        canonicalPersonId,
      });
    }

    for (const e of directive.entities) {
      await this.deps.graph.commitEntity({
        id: e.localId,
        workspaceId,
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
        workspaceId,
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
