/**
 * Learning observation loop v1 (LA2 slice, learning-agent-roadmap-2026-07 §LA2:
 * "corrections/behavior → suggested digest (batched, annoyance-capped)").
 *
 * Generic, Module-agnostic machinery — the light-egg rule from the Deal Copilot
 * requirements (outputs/2026-08-01-deal-copilot-agentic-freelancer-requirements.md
 * §3) applies: this file knows NOTHING about deals, jobs, or any domain. A
 * Module supplies `ObservedSignal`s (a pure attribute mapping, e.g.
 * @bridge/dealpilot `dealDecisionSignal`); this loop turns repeated signals
 * into SUGGESTED preference Memories that only an explicit Human acceptance
 * converts into a learned preference.
 *
 * Invariants carried from the Learning Agent canon (docs/wiki/learning-agent.md):
 *  - suggested-then-accepted: `digestSignals` NEVER writes a preference row —
 *    only `acceptSuggestion` (with a Human actor) does;
 *  - everything stored is an inspectable/deletable MemoryStore row (no new
 *    table, no migration — signals are episodic Memories, suggestions and
 *    preferences ride the existing lineage machinery);
 *  - learned content is data, never instructions: preferences project into the
 *    run context's generic `RetrievedMemorySnippet` slot, whose prompt
 *    projection already spotlights snippets as data;
 *  - annoyance cap: one digest run proposes at most `maxSuggestions`, and a
 *    pattern with ANY existing suggestion lineage (proposed, accepted, or
 *    rejected) is never re-proposed.
 */
import type { RetrievedMemorySnippet } from "../run-context.js";
import type {
  MemoryAuthScope,
  MemoryEntry,
  MemoryStore,
} from "../memory/memory-store.js";

/** One observed user interaction a Module reports to the learning loop.
 * `attributes` are the generalizable facets of the interaction (e.g.
 * `{ industry: "hvac", geo: "texas" }`) — pattern detection groups on them. */
export interface ObservedSignal {
  id: string;
  organizationId: string;
  ownerUserId: string;
  /** Installed Module this signal came from (e.g. "dealpilot"). */
  moduleId: string;
  /** Domain record kind the user acted on (e.g. "deal"). */
  recordKind: string;
  recordId: string;
  /** The explicit user action (e.g. "pursue" | "dismiss" | "review"). */
  action: string;
  attributes: Record<string, string>;
  /** Optional verbatim user-stated reason (kept as data, never instructions). */
  reason?: string;
  observedAt?: string;
}

/** A repeated pattern the digest detected: the same action over the same
 * attribute value, seen `count` times. */
export interface DetectedPattern {
  action: string;
  attributeKey: string;
  attributeValue: string;
  count: number;
  evidenceSignalIds: string[];
}

export type SuggestionStatus = "proposed" | "accepted" | "rejected";

/** A suggestion row's parsed content (stored as JSON in Memory `content`). */
export interface LearningSuggestion {
  /** The Memory row id carrying the CURRENT state of this suggestion. */
  memoryId: string;
  moduleId: string;
  status: SuggestionStatus;
  pattern: DetectedPattern;
  /** Human-readable proposal shown for acceptance. */
  suggestedText: string;
}

/** A learned preference's parsed content (only ever written by `acceptSuggestion`). */
export interface LearnedPreference {
  memoryId: string;
  moduleId: string;
  statement: string;
  pattern: DetectedPattern;
  provenance: { suggestionId: string; evidenceSignalIds: string[] };
}

const SIGNAL_KIND = "observed_signal";
const SUGGESTION_KIND = "learning_suggestion";
const PREFERENCE_KIND = "learned_preference";

/** Stable lineage key for one pattern's suggestion — at most one suggestion
 * lineage ever exists per (module, action, attribute) pattern, which is what
 * makes "never re-suggest a rejected pattern" a store-level guarantee. */
export function suggestionLineageKey(moduleId: string, pattern: Pick<DetectedPattern, "action" | "attributeKey" | "attributeValue">): string {
  return `learning:suggestion:${moduleId}:${pattern.action}:${pattern.attributeKey}=${pattern.attributeValue}`;
}

/** Record one observed interaction as a private, Local-Plane episodic Memory.
 * `subjectRecordId`/`sourceRefId` stay null: the domain record id is not
 * guaranteed to be a uuid (the persistent adapter's columns are uuid-typed),
 * and it is preserved verbatim inside `content.recordId`. */
export async function recordSignal(store: MemoryStore, signal: ObservedSignal): Promise<MemoryEntry> {
  return store.write({
    id: signal.id,
    organizationId: signal.organizationId,
    type: "episodic",
    subjectRecordId: null,
    scope: "private",
    content: JSON.stringify({
      anchor: { kind: SIGNAL_KIND, moduleId: signal.moduleId, action: signal.action },
      recordKind: signal.recordKind,
      recordId: signal.recordId,
      attributes: signal.attributes,
      ...(signal.reason ? { reason: signal.reason } : {}),
      observedAt: signal.observedAt ?? null,
    }),
    sourceRefType: "feedback",
    sourceRefId: null,
    confidence: 1,
    trustOrigin: "user_content",
    plane: "local",
    createdBy: signal.ownerUserId,
    ownerUserId: signal.ownerUserId,
    ...(signal.observedAt ? { createdAt: signal.observedAt } : {}),
  });
}

export interface DigestOptions {
  organizationId: string;
  ownerUserId: string;
  moduleId: string;
  /** How many times a pattern must repeat before it is suggested. Default 3 —
   * a starting proxy in the spirit of the promotion defaults (vision wiki
   * §Promotion defaults); tunable policy, not canon. */
  minRepetitions?: number;
  /** Annoyance cap: at most this many NEW suggestions per digest run. Default 3. */
  maxSuggestions?: number;
  /** How many recent signals one digest considers. Default 200. */
  signalWindow?: number;
  /** Id factory for new suggestion rows (determinism seam — callers with a
   * `RunCtx` pass its ids; tests pass a counter). */
  nextId: () => string;
  /** Maps a human-readable lineage key to the stored `subjectRecordId`.
   * Identity by default (in-memory adapter). Callers on the PERSISTENT
   * adapter — whose `subject_record_id` column is uuid-typed — MUST pass a
   * deterministic uuid derivation (the API layer passes `deterministicUuid`)
   * and must pass the SAME mapper on every digest so suppression holds. */
  lineageIdFor?: (key: string) => string;
}

function parseContent(entry: MemoryEntry): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(entry.content);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Detect repeated patterns in recorded signals and propose NEW suggestions
 * for them (suggested-then-accepted: proposals only — no preference is written
 * here). Returns the suggestions newly created by THIS run. */
export async function digestSignals(store: MemoryStore, options: DigestOptions): Promise<LearningSuggestion[]> {
  const scope: MemoryAuthScope = { organizationId: options.organizationId, userId: options.ownerUserId };
  const minRepetitions = options.minRepetitions ?? 3;
  const maxSuggestions = options.maxSuggestions ?? 3;

  const signals = await store.retrieve(
    {
      type: "episodic",
      sourceRefType: "feedback",
      contentPathEquals: [
        { path: "anchor.kind", equals: SIGNAL_KIND },
        { path: "anchor.moduleId", equals: options.moduleId },
      ],
      limit: options.signalWindow ?? 200,
    },
    scope,
  );

  // Group by (action, attributeKey, attributeValue).
  const byPattern = new Map<string, DetectedPattern>();
  for (const entry of signals) {
    const content = parseContent(entry);
    if (!content) continue;
    const anchor = content["anchor"] as { action?: unknown } | undefined;
    const action = typeof anchor?.action === "string" ? anchor.action : null;
    const attributes = content["attributes"];
    if (!action || attributes === null || typeof attributes !== "object") continue;
    for (const [key, value] of Object.entries(attributes as Record<string, unknown>)) {
      if (typeof value !== "string" || value.length === 0) continue;
      const patternKey = `${action}:${key}=${value}`;
      const existing = byPattern.get(patternKey);
      if (existing) {
        existing.count += 1;
        existing.evidenceSignalIds.push(entry.id);
      } else {
        byPattern.set(patternKey, { action, attributeKey: key, attributeValue: value, count: 1, evidenceSignalIds: [entry.id] });
      }
    }
  }

  const created: LearningSuggestion[] = [];
  const candidates = [...byPattern.values()]
    .filter((p) => p.count >= minRepetitions)
    .sort((a, b) => b.count - a.count);

  const lineageIdFor = options.lineageIdFor ?? ((key: string) => key);
  for (const pattern of candidates) {
    if (created.length >= maxSuggestions) break;
    const lineageKey = lineageIdFor(suggestionLineageKey(options.moduleId, pattern));
    // Any existing lineage row (proposed/accepted/rejected) suppresses
    // re-proposal — a rejected suggestion stays rejected until the Human
    // deletes it (inspect/correct/delete stays with the user).
    const current = await store.currentForLineage(options.organizationId, options.ownerUserId, lineageKey);
    if (current) continue;
    const suggestedText =
      `You have chosen "${pattern.action}" ${pattern.count} times when ${pattern.attributeKey} is "${pattern.attributeValue}". ` +
      `Remember this as a preference?`;
    const id = options.nextId();
    const row = await store.casSupersede({
      organizationId: options.organizationId,
      ownerUserId: options.ownerUserId,
      lineageKey,
      expectedCurrentId: null,
      next: {
        id,
        organizationId: options.organizationId,
        type: "semantic",
        subjectRecordId: lineageKey,
        scope: "private",
        content: JSON.stringify({
          anchor: { kind: SUGGESTION_KIND, moduleId: options.moduleId, status: "proposed" satisfies SuggestionStatus },
          pattern,
          suggestedText,
        }),
        sourceRefType: "feedback",
        sourceRefId: pattern.evidenceSignalIds[0] ?? null,
        confidence: Math.min(1, pattern.count / (minRepetitions * 2)),
        trustOrigin: "user_content",
        plane: "local",
        createdBy: "learning-observation",
        ownerUserId: options.ownerUserId,
      },
    });
    if (row) {
      created.push({ memoryId: row.id, moduleId: options.moduleId, status: "proposed", pattern, suggestedText });
    }
  }
  return created;
}

/** List suggestion lineage heads for a Module, optionally filtered by status. */
export async function listSuggestions(
  store: MemoryStore,
  scope: MemoryAuthScope,
  moduleId: string,
  status?: SuggestionStatus,
): Promise<LearningSuggestion[]> {
  const rows = await store.retrieve(
    {
      type: "semantic",
      contentPathEquals: [
        { path: "anchor.kind", equals: SUGGESTION_KIND },
        { path: "anchor.moduleId", equals: moduleId },
        ...(status ? [{ path: "anchor.status", equals: status }] : []),
      ],
    },
    scope,
  );
  const suggestions: LearningSuggestion[] = [];
  for (const row of rows) {
    const content = parseContent(row);
    if (!content) continue;
    const anchor = content["anchor"] as { status?: unknown } | undefined;
    suggestions.push({
      memoryId: row.id,
      moduleId,
      status: (typeof anchor?.status === "string" ? anchor.status : "proposed") as SuggestionStatus,
      pattern: content["pattern"] as unknown as DetectedPattern,
      suggestedText: typeof content["suggestedText"] === "string" ? (content["suggestedText"] as string) : "",
    });
  }
  return suggestions;
}

async function transitionSuggestion(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  toStatus: SuggestionStatus,
  actorUserId: string,
  nextId: () => string,
): Promise<MemoryEntry> {
  const current = await store.get(suggestionMemoryId, scope);
  if (!current) throw new Error(`learning: unknown or unauthorized suggestion ${suggestionMemoryId}`);
  const content = parseContent(current);
  const anchor = content?.["anchor"] as { kind?: unknown; status?: unknown; moduleId?: unknown } | undefined;
  if (!content || anchor?.kind !== SUGGESTION_KIND) {
    throw new Error(`learning: memory ${suggestionMemoryId} is not a learning suggestion`);
  }
  // The fetched row's own content is not authoritative for state: after a
  // transition, the OLD row still says "proposed" — only the lineage HEAD
  // carries the current status. Guard against acting on a superseded row.
  const head = await store.currentForLineage(
    current.organizationId,
    current.ownerUserId ?? actorUserId,
    current.subjectRecordId ?? "",
  );
  if (!head || head.id !== current.id) {
    const headAnchor = head ? (parseContent(head)?.["anchor"] as { status?: unknown } | undefined) : undefined;
    throw new Error(
      `learning: suggestion ${suggestionMemoryId} is already ${typeof headAnchor?.status === "string" ? headAnchor.status : "superseded"}`,
    );
  }
  if (anchor.status !== "proposed") {
    throw new Error(`learning: suggestion ${suggestionMemoryId} is already ${String(anchor.status)}`);
  }
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
  if (!next) throw new Error(`learning: suggestion ${suggestionMemoryId} was concurrently modified — re-read and retry`);
  return next;
}

/** Human accepts a proposed suggestion: the suggestion lineage moves to
 * `accepted` AND a `preference` Memory is written with full provenance. This
 * is the ONLY code path that mints a learned preference. */
export async function acceptSuggestion(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  actorUserId: string,
  nextId: () => string,
): Promise<{ suggestion: MemoryEntry; preference: MemoryEntry }> {
  const current = await store.get(suggestionMemoryId, scope);
  if (!current) throw new Error(`learning: unknown or unauthorized suggestion ${suggestionMemoryId}`);
  const content = parseContent(current);
  const pattern = content?.["pattern"] as DetectedPattern | undefined;
  const anchor = content?.["anchor"] as { moduleId?: unknown } | undefined;
  const moduleId = typeof anchor?.moduleId === "string" ? anchor.moduleId : "unknown";
  const accepted = await transitionSuggestion(store, scope, suggestionMemoryId, "accepted", actorUserId, nextId);
  // A pattern with zero local observations (a Commons-archetype seed the
  // Human accepted) words the preference without a count — "seen 0 times"
  // would misstate how it was learned.
  const statement = pattern
    ? pattern.count > 0
      ? `Prefers "${pattern.action}" when ${pattern.attributeKey} is "${pattern.attributeValue}" (seen ${pattern.count} times).`
      : `Prefers "${pattern.action}" when ${pattern.attributeKey} is "${pattern.attributeValue}".`
    : (typeof content?.["suggestedText"] === "string" ? (content["suggestedText"] as string) : "Accepted learned preference.");
  const preference = await store.write({
    id: nextId(),
    organizationId: current.organizationId,
    type: "preference",
    subjectRecordId: null,
    scope: "private",
    content: JSON.stringify({
      anchor: { kind: PREFERENCE_KIND, moduleId },
      statement,
      pattern: pattern ?? null,
      provenance: { suggestionId: accepted.id, evidenceSignalIds: pattern?.evidenceSignalIds ?? [] },
    }),
    sourceRefType: "feedback",
    sourceRefId: accepted.id,
    confidence: current.confidence,
    trustOrigin: "user_content",
    plane: "local",
    createdBy: actorUserId,
    ownerUserId: current.ownerUserId ?? null,
  });
  return { suggestion: accepted, preference };
}

/** Human rejects a proposed suggestion. No preference is written; the lineage
 * head becomes `rejected`, which suppresses any re-proposal of the pattern. */
export async function rejectSuggestion(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  actorUserId: string,
  nextId: () => string,
): Promise<MemoryEntry> {
  return transitionSuggestion(store, scope, suggestionMemoryId, "rejected", actorUserId, nextId);
}

/** Current learned preferences (accepted only, by construction — preferences
 * are only ever minted by `acceptSuggestion`). Omitting `moduleId` returns
 * preferences across ALL installed Modules — the shape a generic surface
 * (e.g. Chief of Staff chat) needs, since the light-egg rule forbids it from
 * knowing which Modules exist. */
export async function retrieveLearnedPreferences(
  store: MemoryStore,
  scope: MemoryAuthScope,
  moduleId?: string,
): Promise<LearnedPreference[]> {
  const rows = await store.retrieve(
    {
      type: "preference",
      contentPathEquals: [
        { path: "anchor.kind", equals: PREFERENCE_KIND },
        ...(moduleId ? [{ path: "anchor.moduleId", equals: moduleId }] : []),
      ],
    },
    scope,
  );
  const preferences: LearnedPreference[] = [];
  for (const row of rows) {
    const content = parseContent(row);
    if (!content) continue;
    const anchor = content["anchor"] as { moduleId?: unknown } | undefined;
    preferences.push({
      memoryId: row.id,
      moduleId: moduleId ?? (typeof anchor?.moduleId === "string" ? anchor.moduleId : "unknown"),
      statement: typeof content["statement"] === "string" ? (content["statement"] as string) : "",
      pattern: content["pattern"] as unknown as DetectedPattern,
      provenance: content["provenance"] as LearnedPreference["provenance"],
    });
  }
  return preferences;
}

/** True when a Memory row is internal learning-loop machinery (a raw signal,
 * a suggestion lineage row, or a minted preference row). Generic memory
 * surfaces (e.g. the chat run-context's recent-memory slice) use this to keep
 * raw learning JSON out of prompts: preferences reach the model ONLY as
 * `preferencesToMemorySnippets` statements, and signals/suggestions never do. */
export function isLearningObservationEntry(entry: Pick<MemoryEntry, "content">): boolean {
  try {
    const parsed: unknown = JSON.parse(entry.content);
    if (parsed === null || typeof parsed !== "object") return false;
    const anchor = (parsed as { anchor?: { kind?: unknown } }).anchor;
    return (
      anchor?.kind === SIGNAL_KIND ||
      anchor?.kind === SUGGESTION_KIND ||
      anchor?.kind === PREFERENCE_KIND
    );
  } catch {
    return false;
  }
}

/** Project learned preferences into the run context's generic memory slot —
 * the LA1 exit criterion ("accepted Memory demonstrably changes agent
 * output") made concrete: callers pass the result as
 * `AssembleRunContextInput.memory`. */
export function preferencesToMemorySnippets(preferences: LearnedPreference[]): RetrievedMemorySnippet[] {
  return preferences.map((preference) => ({
    source: `memory:${preference.memoryId}`,
    text: preference.statement,
    trustOrigin: "user_content" as const,
  }));
}
