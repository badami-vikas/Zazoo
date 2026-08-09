/**
 * Knowledge substrate v1 (AI Harness K3, TASK-047) — the claims layer of the
 * second brain, minimal cut.
 *
 * One substrate, two projections: the entities/claims tables are the harness
 * spine's STORE rung (what retrieval fusion and later the brief/Builder read),
 * and the Second Brain UI is the human window onto the same rows. This module
 * is the pure half: claim-suggestion lifecycle over the Memory store (the same
 * lineage/CAS machinery preferences and promotions use) plus the port the
 * persisted store implements. Nothing here talks to a database or a pipeline.
 *
 * Structural guarantees, in the K2 style (make the bad state inexpressible):
 *
 *  - RED CLASSES ARE UNPROPOSABLE. `ProposableClaimClass` is a closed union
 *    that does not contain the red classes (health, protected characteristics,
 *    psychological conclusions — ADR-176 invariant 15). There is no code path
 *    that accepts a red-class claim, only a type that cannot spell one.
 *  - MATERIALIZATION REQUIRES A DECISION. `MaterializeClaimInput.decisionRef`
 *    is required: the persisted store cannot be handed a claim that did not
 *    come through a governed proposal, because the input type has no way to
 *    omit the decision reference.
 *  - SUPERSEDENCE, NEVER DELETION. A contradicting claim invalidates its
 *    predecessor by lineage (`supersededBy` + bi-temporal `validTo`/
 *    `invalidatedAt`); the only true delete is the user's forget path.
 */
import type { MemoryAuthScope, MemoryEntry, MemoryStore } from "../memory/memory-store.js";
import type { RetrievedMemorySnippet } from "../run-context.js";
import { TAINT_SENSITIVITY, type TaintLabel, type TaintSensitivity } from "../taint.js";

export const CLAIM_SUGGESTION_KIND = "claim_suggestion";

/** Never-propose claim classes (ADR-176 invariant 15). Exported so guards and
 * tests can assert the boundary, but deliberately NOT part of any input type:
 * the only thing code can do with a red class is refuse it. */
export const RED_CLAIM_CLASSES = [
  "health",
  "protected_characteristic",
  "psychological_conclusion",
] as const;
export type RedClaimClass = (typeof RED_CLAIM_CLASSES)[number];

/** The v1 proposable claim classes — deliberately tiny. `stated_fact` is a
 * claim the Human stated or confirmed themselves; `observed_preference` is a
 * digest-detected pattern the Human accepted. Growing this union is a code
 * change reviewed against the red list, which is the point. */
export const PROPOSABLE_CLAIM_CLASSES = ["stated_fact", "observed_preference"] as const;
export type ProposableClaimClass = (typeof PROPOSABLE_CLAIM_CLASSES)[number];

/** v1 entity kinds: the three regions the graph already holds, plus `topic`
 * as the single net-new kind. Module-vocabulary-typed expansion is a later
 * rung; a fixed closed union keeps v1 honest. */
export const CLAIM_ENTITY_KINDS = ["person", "community", "task", "topic"] as const;
export type ClaimEntityKind = (typeof CLAIM_ENTITY_KINDS)[number];

/** Per-claim evidence pointer (ADR-176 claim→evidence map). `span` is the
 * character range inside the evidence row's prose that grounds the claim —
 * optional in v1 because the only proposers are user-confirmed flows, but the
 * field exists so the later distiller has somewhere to put spans. */
export interface ClaimEvidenceRef {
  kind: "memory" | "ledger";
  id: string;
  span?: { start: number; end: number };
}

/** Sensitivity ranks for the raise-only rule. `unknown` ranks WITH
 * `restricted` — unknown is sensitive (the K11a fail-closed reading), never a
 * way to launder a label down. */
const SENSITIVITY_RANK: Record<TaintSensitivity, number> = {
  public: 0,
  organization: 1,
  private: 2,
  restricted: 3,
  unknown: 3,
};

/** Raise-only sensitivity join (invariant 15): a claim is at least as
 * sensitive as every piece of evidence it rests on. */
export function raiseSensitivity(
  base: TaintSensitivity,
  ...others: TaintSensitivity[]
): TaintSensitivity {
  let winner: TaintSensitivity = base;
  for (const candidate of others) {
    if (SENSITIVITY_RANK[candidate] > SENSITIVITY_RANK[winner]) winner = candidate;
  }
  // `unknown` and `restricted` share a rank; prefer the NAMED tier so a claim
  // never carries the less informative label when a comparison tied.
  return winner === "unknown" ? "restricted" : winner;
}

export function isTaintSensitivity(value: unknown): value is TaintSensitivity {
  return typeof value === "string" && (TAINT_SENSITIVITY as readonly string[]).includes(value);
}

/** The claim a suggestion proposes and an acceptance materializes. */
export interface ClaimProposal {
  entity: { kind: ClaimEntityKind; name: string; refRecordId?: string | null };
  /** The attribute being claimed (e.g. "role", "timezone", "preferred channel"). */
  field: string;
  value: string;
  claimClass: ProposableClaimClass;
  sensitivity: TaintSensitivity;
  evidence: ClaimEvidenceRef[];
  /** When the claim became true in the WORLD (bi-temporal `validFrom`);
   * absent = unknown, the store falls back to the recording time. */
  validFrom?: string;
  taintLabel?: TaintLabel;
}

export type ClaimSuggestionStatus = "proposed" | "accepted" | "rejected";

export interface ClaimSuggestion {
  memoryId: string;
  status: ClaimSuggestionStatus;
  claim: ClaimProposal;
  suggestedText: string;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Stable lineage key — one suggestion lineage per (entity, field, value).
 * The VALUE is part of the key: rejecting "timezone = UTC" must never
 * re-surface, while a later "timezone = CET" is a NEW proposal (whose
 * acceptance supersedes the old claim at the TABLE level, not here). */
export function claimSuggestionLineageKey(
  claim: Pick<ClaimProposal, "entity" | "field" | "value">,
): string {
  const name = normalizeToken(claim.entity.name);
  const field = normalizeToken(claim.field);
  const value = normalizeToken(claim.value).slice(0, 80);
  return `learning:claim:${claim.entity.kind}:${name}:${field}=${value}`;
}

function parseContent(entry: MemoryEntry): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(entry.content);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Parse one Memory row as a claim suggestion — null when it is not one.
 * Exported for the API layer, which needs the claim payload BEFORE deciding
 * whether the governed pipeline will allow materialization. */
export function readClaimSuggestion(entry: MemoryEntry): ClaimSuggestion | null {
  const content = parseContent(entry);
  if (!content) return null;
  const anchor = content["anchor"] as { kind?: unknown; status?: unknown } | undefined;
  if (anchor?.kind !== CLAIM_SUGGESTION_KIND) return null;
  const claim = content["claim"] as ClaimProposal | undefined;
  if (!claim) return null;
  return {
    memoryId: entry.id,
    status: (typeof anchor.status === "string" ? anchor.status : "proposed") as ClaimSuggestionStatus,
    claim,
    suggestedText: typeof content["suggestedText"] === "string" ? (content["suggestedText"] as string) : "",
  };
}

export interface ProposeClaimOptions {
  organizationId: string;
  ownerUserId: string;
  claim: ClaimProposal;
  nextId: () => string;
  /** Same lineage-key mapper contract as the digest's `lineageIdFor`. */
  lineageIdFor?: (key: string) => string;
}

/** PROPOSE a claim as a suggestion Memory row. Nothing is knowledge until an
 * explicit Human acceptance materializes it. Returns null when this exact
 * (entity, field, value) lineage already has a head — a rejected proposal is
 * never re-proposed, an accepted or pending one is never duplicated. The
 * claim's sensitivity is raise-only joined with its taint label's before the
 * row is written, so a suggestion can never carry a label BELOW its source. */
export async function proposeClaimSuggestion(
  store: MemoryStore,
  options: ProposeClaimOptions,
): Promise<ClaimSuggestion | null> {
  const lineageIdFor = options.lineageIdFor ?? ((key: string) => key);
  const lineageKey = lineageIdFor(claimSuggestionLineageKey(options.claim));
  const current = await store.currentForLineage(
    options.organizationId,
    options.ownerUserId,
    lineageKey,
  );
  if (current) return null;
  const sensitivity = raiseSensitivity(
    options.claim.sensitivity,
    ...(options.claim.taintLabel ? [options.claim.taintLabel.sensitivity] : []),
  );
  const claim: ClaimProposal = { ...options.claim, sensitivity };
  const suggestedText =
    `Remember about ${claim.entity.name}: ${claim.field} is "${claim.value}"? ` +
    `Accepting stores this as a claim you can inspect, correct, or delete at any time.`;
  const row = await store.casSupersede({
    organizationId: options.organizationId,
    ownerUserId: options.ownerUserId,
    lineageKey,
    expectedCurrentId: null,
    next: {
      id: options.nextId(),
      organizationId: options.organizationId,
      type: "semantic",
      subjectRecordId: lineageKey,
      scope: "private",
      content: JSON.stringify({
        anchor: {
          kind: CLAIM_SUGGESTION_KIND,
          status: "proposed" satisfies ClaimSuggestionStatus,
          claimClass: claim.claimClass,
          entityKind: claim.entity.kind,
        },
        claim,
        suggestedText,
      }),
      sourceRefType: "feedback",
      sourceRefId: null,
      confidence: 1,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: options.ownerUserId,
      ownerUserId: options.ownerUserId,
      ...(claim.taintLabel ? { taintLabel: claim.taintLabel } : {}),
    },
  });
  return row ? readClaimSuggestion(row) : null;
}

export async function listClaimSuggestions(
  store: MemoryStore,
  scope: MemoryAuthScope,
  status?: ClaimSuggestionStatus,
): Promise<ClaimSuggestion[]> {
  const rows = await store.retrieve(
    {
      type: "semantic",
      contentPathEquals: [
        { path: "anchor.kind", equals: CLAIM_SUGGESTION_KIND },
        ...(status ? [{ path: "anchor.status", equals: status }] : []),
      ],
    },
    scope,
  );
  const suggestions: ClaimSuggestion[] = [];
  for (const row of rows) {
    const parsed = readClaimSuggestion(row);
    if (parsed) suggestions.push(parsed);
  }
  return suggestions;
}

async function transitionClaimSuggestion(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  toStatus: ClaimSuggestionStatus,
  actorUserId: string,
  nextId: () => string,
): Promise<{ entry: MemoryEntry; suggestion: ClaimSuggestion }> {
  const current = await store.get(suggestionMemoryId, scope);
  if (!current) throw new Error(`claims: unknown or unauthorized claim suggestion ${suggestionMemoryId}`);
  const parsed = readClaimSuggestion(current);
  if (!parsed) throw new Error(`claims: memory ${suggestionMemoryId} is not a claim suggestion`);
  const head = await store.currentForLineage(
    current.organizationId,
    current.ownerUserId ?? actorUserId,
    current.subjectRecordId ?? "",
  );
  if (!head || head.id !== current.id) {
    throw new Error(`claims: claim suggestion ${suggestionMemoryId} was superseded — re-read and retry`);
  }
  if (parsed.status !== "proposed") {
    throw new Error(`claims: claim suggestion ${suggestionMemoryId} is already ${parsed.status}`);
  }
  const content = parseContent(current)!;
  const anchor = content["anchor"] as Record<string, unknown>;
  const next = await store.casSupersede({
    organizationId: current.organizationId,
    ownerUserId: current.ownerUserId ?? actorUserId,
    lineageKey: current.subjectRecordId ?? "",
    expectedCurrentId: current.id,
    next: {
      id: nextId(),
      organizationId: current.organizationId,
      type: "semantic",
      subjectRecordId: current.subjectRecordId ?? null,
      scope: "private",
      content: JSON.stringify({ ...content, anchor: { ...anchor, status: toStatus } }),
      sourceRefType: current.sourceRefType ?? null,
      sourceRefId: current.sourceRefId ?? null,
      confidence: current.confidence,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: actorUserId,
      ownerUserId: current.ownerUserId ?? null,
    },
  });
  if (!next) throw new Error(`claims: claim suggestion ${suggestionMemoryId} was concurrently modified — re-read and retry`);
  const nextParsed = readClaimSuggestion(next);
  if (!nextParsed) throw new Error(`claims: claim suggestion ${suggestionMemoryId} became unreadable after transition`);
  return { entry: next, suggestion: nextParsed };
}

/** Human accepts: the lineage moves to `accepted` and the claim payload is
 * returned for the CALLER to materialize through the governed pipeline. This
 * function never writes the claims table — it has no handle to it. */
export async function acceptClaimSuggestion(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  actorUserId: string,
  nextId: () => string,
): Promise<{ suggestion: ClaimSuggestion; claim: ClaimProposal }> {
  const { suggestion } = await transitionClaimSuggestion(
    store, scope, suggestionMemoryId, "accepted", actorUserId, nextId,
  );
  return { suggestion, claim: suggestion.claim };
}

/** Human rejects: this (entity, field, value) is never re-proposed. */
export async function rejectClaimSuggestion(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  actorUserId: string,
  nextId: () => string,
): Promise<ClaimSuggestion> {
  const { suggestion } = await transitionClaimSuggestion(
    store, scope, suggestionMemoryId, "rejected", actorUserId, nextId,
  );
  return suggestion;
}

// ---------------------------------------------------------------------------
// The persisted-store port (implemented by @bridge/db over the shared schema).
// ---------------------------------------------------------------------------

export interface ClaimEntityRecord {
  id: string;
  organizationId: string;
  ownerUserId: string;
  kind: ClaimEntityKind;
  name: string;
  refRecordId: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface ClaimRecord {
  id: string;
  organizationId: string;
  ownerUserId: string;
  entityId: string;
  field: string;
  value: string;
  claimClass: ProposableClaimClass;
  sensitivity: TaintSensitivity;
  evidence: ClaimEvidenceRef[];
  taintLabel: TaintLabel | null;
  /** Bi-temporal (Graphiti's model behind our own port): when true in the
   * world (`validFrom`/`validTo`) vs when learned/invalidated by Bridge
   * (`recordedAt`/`invalidatedAt`). A live claim has null `validTo`,
   * `invalidatedAt`, and `supersededBy`. */
  validFrom: string;
  validTo: string | null;
  recordedAt: string;
  invalidatedAt: string | null;
  supersededBy: string | null;
  /** The governed proposal/ledger reference that authorized this row —
   * REQUIRED at materialization; its presence on every row is the audit
   * trail that no claim exists without a decision. */
  decisionRef: string;
  createdBy: string;
  archivedAt: string | null;
}

export interface MaterializeClaimInput {
  organizationId: string;
  ownerUserId: string;
  claim: ClaimProposal;
  /** Governed proposal id (Universal Action Pipeline). Required — the type
   * has no way to express an ungoverned write. */
  decisionRef: string;
  createdBy: string;
  now?: string;
}

export interface ClaimStorePort {
  /** Find-or-create the entity row for (org, owner, kind, normalized name). */
  ensureEntity(input: {
    organizationId: string;
    ownerUserId: string;
    kind: ClaimEntityKind;
    name: string;
    refRecordId?: string | null;
  }): Promise<ClaimEntityRecord>;
  /** Insert the claim; if a LIVE claim exists for the same (entity, field) it
   * is invalidated by lineage in the same transaction (`supersededBy`,
   * `validTo`, `invalidatedAt`) — contradiction never deletes. */
  materializeClaim(
    input: MaterializeClaimInput,
  ): Promise<{ claim: ClaimRecord; supersededClaimId: string | null }>;
  listEntities(
    organizationId: string,
    ownerUserId: string,
  ): Promise<Array<ClaimEntityRecord & { liveClaimCount: number }>>;
  liveClaims(
    organizationId: string,
    ownerUserId: string,
    filter?: { entityId?: string },
  ): Promise<ClaimRecord[]>;
  /** Full lineage for one (entity, field), newest first — the Second Brain's
   * supersedence history view. */
  claimHistory(
    organizationId: string,
    ownerUserId: string,
    entityId: string,
    field: string,
  ): Promise<ClaimRecord[]>;
  /** The user's forget path — the ONLY true delete. */
  deleteClaim(organizationId: string, ownerUserId: string, claimId: string): Promise<boolean>;
}

/** Project live claims into the run context's generic memory slot — the same
 * seam preferences use, which is what makes "what the user sees is what the
 * model retrieves" literal: both projections read the same rows. */
export function claimsToMemorySnippets(
  claims: Array<Pick<ClaimRecord, "id" | "field" | "value"> & { entityName: string }>,
): RetrievedMemorySnippet[] {
  return claims.map((claim) => ({
    source: `claim:${claim.id}`,
    text: `Accepted claim — ${claim.entityName}: ${claim.field} is ${claim.value}.`,
    trustOrigin: "user_content" as const,
  }));
}
