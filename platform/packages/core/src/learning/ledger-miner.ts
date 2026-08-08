/**
 * Generic ledger→signal miner (AI Harness K1, ADR-210 — "every governed
 * in-app action becomes learning input; delete the per-module mapping
 * forever").
 *
 * The append-only ledger already records ALL in-app activity as a byproduct
 * of the governed pipeline. This file mines it: a Human's decision on a
 * proposal (approve / veto / edit) becomes a generic `ObservedSignal`, so a
 * Module gets learning coverage by EXISTING — the moment its Skills run
 * through the pipeline, its decisions are learning input, with zero
 * module-specific plumbing. The DealPilot attribute mapping this replaces
 * (`dealDecisionSignal`) is deleted, not deprecated.
 *
 * Boundaries, each load-bearing:
 *
 *  - **Envelope fields only.** A ledger row's `inputs`/`proposedOutput`/`diff`
 *    can carry private content (a drafted message, a person's details). The
 *    miner never reads them — a signal is built from the attribution envelope
 *    alone (skill, action, resourceType, decision, timestamps). This is
 *    structural: the mapping function receives a pre-narrowed envelope type
 *    that cannot express the payload fields.
 *  - **Human decisions only.** `userDecision` must be approve/veto/edit.
 *    `"auto"` rows are excluded by design: an auto-applied decision is the
 *    machine echoing its own prior calibration, and learning from it would
 *    amplify the machine's behavior instead of the Human's judgment. Undecided
 *    proposals are not decisions at all.
 *  - **One attribute: `skill`.** The skill id is the repo's capability-
 *    attribution key (the same grouping the Agent Quality Vector scores by).
 *    Low-cardinality envelope facets (resourceType, proposer kind) would
 *    dominate pattern counts and crowd the annoyance-capped digest with
 *    trivially-true suggestions, so they are deliberately NOT attributes.
 *    Rows without a skill are skipped, not bucketed as "unattributed" —
 *    the pipeline never omits skill on new rows (migration 0037), and a
 *    pattern over an attribution gap teaches nothing.
 *  - **Idempotent.** The signal id derives deterministically from the
 *    decision row's id via the caller's `signalIdFor` seam, and an existing
 *    row with that id is skipped — re-mining a window is a no-op, so the
 *    scheduled pass needs no cursor to be safe.
 *
 * Honest limitation (single-tenant): the decision row inherits the PROPOSAL's
 * actor (pipeline.ts's documented capability-attribution choice), so the
 * ledger does not say which Human decided. The miner attributes every mined
 * decision to the owner it mines for — correct while `assertPilotOrganization`
 * admits one tenant, and a named gap for the multi-user ledger work.
 */
import type { LedgerEntry } from "../types.js";
import type { MemoryAuthScope, MemoryStore } from "../memory/memory-store.js";
import { recordSignal, type ObservedSignal } from "./observation.js";

/** The two reads the miner needs — structurally narrower than `LedgerStore`
 * so tests and alternate spines can satisfy it without an append surface. */
export interface LedgerHistoryReader {
  listHistory(
    organizationId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: LedgerEntry[]; total: number }>;
}

/** The envelope slice of a ledger row the miner is allowed to see. The
 * payload fields (`inputs`, `proposedOutput`, `diff`) are absent from this
 * type on purpose — `signalFromDecision` takes THIS, so lifting payload
 * content into a signal is unrepresentable, not merely avoided. */
export interface LedgerDecisionEnvelope {
  id: string;
  userDecision: LedgerEntry["userDecision"];
  refLedgerId?: string;
  skill?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  actorType: string;
  createdAt: string;
}

const HUMAN_DECISIONS = new Set(["approve", "veto", "edit"]);

/** Module attribution from the capability-attribution key: the segment before
 * the first "." (skills are namespaced `<module>.<name>`); a dotless skill is
 * platform machinery. */
export function moduleIdForSkill(skill: string): string {
  const dot = skill.indexOf(".");
  return dot > 0 ? skill.slice(0, dot) : "platform";
}

/** Map ONE human decision envelope to a generic observed signal, or null when
 * the row is not minable (not a human decision, or carries no skill
 * attribution). Pure. */
export function signalFromDecision(
  envelope: LedgerDecisionEnvelope,
  options: { organizationId: string; ownerUserId: string; signalIdFor: (ledgerDecisionId: string) => string },
): ObservedSignal | null {
  if (envelope.userDecision === null || !HUMAN_DECISIONS.has(envelope.userDecision)) return null;
  if (!envelope.refLedgerId) return null;
  if (!envelope.skill) return null;
  return {
    id: options.signalIdFor(envelope.id),
    organizationId: options.organizationId,
    ownerUserId: options.ownerUserId,
    moduleId: moduleIdForSkill(envelope.skill),
    recordKind: envelope.resourceType,
    recordId: envelope.resourceId ?? envelope.refLedgerId,
    action: envelope.userDecision,
    attributes: { skill: envelope.skill },
    observedAt: envelope.createdAt,
  };
}

export interface MineLedgerSignalsOptions {
  organizationId: string;
  ownerUserId: string;
  /** Deterministic signal-id derivation from the decision row's id (callers
   * on the persistent adapter pass a uuid derivation; tests pass a prefix).
   * REQUIRED — a random id here would break idempotent re-mining. */
  signalIdFor: (ledgerDecisionId: string) => string;
  /** How many recent ledger rows one pass scans. Default 200 — the same
   * bounded-window posture as the digest's signalWindow. */
  window?: number;
}

export interface MineLedgerSignalsResult {
  /** Signals newly written by THIS pass. */
  mined: ObservedSignal[];
  /** Decision rows whose signal already existed (idempotent re-scan). */
  alreadyMined: number;
  /** Distinct moduleIds across every ELIGIBLE decision in the window — mined
   * AND already-mined. The digest fan-out set must include modules whose
   * signals landed on an earlier pass: a pattern that crosses the repetition
   * threshold after mining went idempotent would otherwise never be digested
   * again. */
  moduleIds: string[];
}

/**
 * Scan recent ledger history and record a signal for every human decision not
 * yet mined. Safe to re-run: deterministic ids + an existence check make the
 * pass idempotent, and the bounded window keeps it O(window) regardless of
 * ledger size.
 */
export async function mineLedgerSignals(
  store: MemoryStore,
  ledger: LedgerHistoryReader,
  options: MineLedgerSignalsOptions,
): Promise<MineLedgerSignalsResult> {
  const { items } = await ledger.listHistory(options.organizationId, {
    limit: options.window ?? 200,
    offset: 0,
  });
  const scope: MemoryAuthScope = { organizationId: options.organizationId, userId: options.ownerUserId };
  const mined: ObservedSignal[] = [];
  const moduleIds = new Set<string>();
  let alreadyMined = 0;
  for (const row of items) {
    // Re-narrow to the envelope type at the boundary: from here on the
    // payload fields are not just unread, they are inexpressible.
    const envelope: LedgerDecisionEnvelope = {
      id: row.id,
      userDecision: row.userDecision,
      ...(row.refLedgerId ? { refLedgerId: row.refLedgerId } : {}),
      ...(row.skill ? { skill: row.skill } : {}),
      action: row.action,
      resourceType: row.resourceType,
      ...(row.resourceId ? { resourceId: row.resourceId } : {}),
      actorType: row.actorType,
      createdAt: row.createdAt,
    };
    const signal = signalFromDecision(envelope, {
      organizationId: options.organizationId,
      ownerUserId: options.ownerUserId,
      signalIdFor: options.signalIdFor,
    });
    if (!signal) continue;
    moduleIds.add(signal.moduleId);
    if (await store.get(signal.id, scope)) {
      alreadyMined += 1;
      continue;
    }
    await recordSignal(store, signal);
    mined.push(signal);
  }
  return { mined, alreadyMined, moduleIds: [...moduleIds] };
}
