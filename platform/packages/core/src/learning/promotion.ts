/**
 * Promotion machinery v1 (roadmap-v2 §Capability Evolution: "User
 * Instruction → Repeated Action → Workflow → ..."; learning-agent roadmap
 * LA2 follow-up "repeated behavior → Automation drafts").
 *
 * Detects that a user keeps performing the SAME action on the same kind of
 * record with the same attribute (a stronger, higher-threshold reading of
 * the observation signals the preference digest already collects) and
 * proposes turning it into an Automation. Everything stays
 * suggested-then-accepted:
 *
 *  - detection PROPOSES a promotion suggestion (Memory lineage, its own
 *    kind) — nothing is created until an explicit Human acceptance;
 *  - acceptance yields a DRAFT `AutomationDefinition` spec (status
 *    "draft", empty steps): a review artifact for the Human/Capability
 *    Builder to flesh out. `AutomationRegistry.load` never returns a
 *    draft, so the executor cannot start it — fail closed by construction;
 *    activation is a later explicit, governed save as "active";
 *  - rejection suppresses the pattern at the store level, exactly like
 *    preference suggestions (one lineage per pattern, CAS-superseded).
 *
 * Module-agnostic (light-egg): this file knows nothing about deals or jobs.
 */
import type { MemoryAuthScope, MemoryEntry, MemoryStore } from "../memory/memory-store.js";
import type { AutomationDefinition } from "../ports.js";
import type { DetectedPattern } from "./observation.js";
import { acceptanceStamp } from "./acceptance-audit.js";

export const PROMOTION_SUGGESTION_KIND = "automation_draft_suggestion";

/** Repetitions before a pattern is worth proposing as an Automation.
 * Deliberately HIGHER than the preference digest's 3 — drafting an
 * Automation is a bigger ask than remembering a preference. Tunable policy,
 * not canon. */
export const PROMOTION_MIN_REPETITIONS = 6;

export type PromotionStatus = "proposed" | "accepted" | "rejected";

export interface PromotionSuggestion {
  memoryId: string;
  moduleId: string;
  status: PromotionStatus;
  pattern: DetectedPattern;
  suggestedText: string;
}

/** Stable lineage key — one promotion lineage per pattern, DISTINCT from the
 * preference-suggestion lineage of the same pattern (a preference and an
 * Automation draft are different promotions of the same behavior). */
export function promotionLineageKey(
  moduleId: string,
  pattern: Pick<DetectedPattern, "action" | "attributeKey" | "attributeValue">,
): string {
  return `learning:promotion:${moduleId}:${pattern.action}:${pattern.attributeKey}=${pattern.attributeValue}`;
}

const SIGNAL_KIND = "observed_signal";

function parseContent(entry: MemoryEntry): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(entry.content);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface DetectPromotionOptions {
  organizationId: string;
  ownerUserId: string;
  moduleId: string;
  minRepetitions?: number;
  /** Annoyance cap: at most this many NEW promotion proposals per run. Default 2. */
  maxSuggestions?: number;
  signalWindow?: number;
  nextId: () => string;
  /** Same lineage-key mapper contract as the digest's `lineageIdFor`. */
  lineageIdFor?: (key: string) => string;
}

/** Detect heavily repeated patterns and PROPOSE Automation-draft suggestions
 * for them. Proposals only — no Automation exists until acceptance. */
export async function detectAutomationDraftCandidates(
  store: MemoryStore,
  options: DetectPromotionOptions,
): Promise<PromotionSuggestion[]> {
  const scope: MemoryAuthScope = { organizationId: options.organizationId, userId: options.ownerUserId };
  const minRepetitions = options.minRepetitions ?? PROMOTION_MIN_REPETITIONS;
  const maxSuggestions = options.maxSuggestions ?? 2;
  const lineageIdFor = options.lineageIdFor ?? ((key: string) => key);

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

  const created: PromotionSuggestion[] = [];
  const candidates = [...byPattern.values()]
    .filter((pattern) => pattern.count >= minRepetitions)
    .sort((a, b) => b.count - a.count);
  for (const pattern of candidates) {
    if (created.length >= maxSuggestions) break;
    const lineageKey = lineageIdFor(promotionLineageKey(options.moduleId, pattern));
    const current = await store.currentForLineage(options.organizationId, options.ownerUserId, lineageKey);
    if (current) continue;
    const suggestedText =
      `You have chosen "${pattern.action}" ${pattern.count} times when ${pattern.attributeKey} is ` +
      `"${pattern.attributeValue}". Draft an Automation for this? A draft never runs — it waits for ` +
      `your review and explicit activation.`;
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
          anchor: { kind: PROMOTION_SUGGESTION_KIND, moduleId: options.moduleId, status: "proposed" satisfies PromotionStatus },
          pattern,
          suggestedText,
        }),
        sourceRefType: "feedback",
        sourceRefId: pattern.evidenceSignalIds[0] ?? null,
        confidence: Math.min(1, pattern.count / (minRepetitions * 2)),
        trustOrigin: "user_content",
        plane: "local",
        createdBy: "learning-promotion",
        ownerUserId: options.ownerUserId,
      },
    });
    if (row) {
      created.push({ memoryId: row.id, moduleId: options.moduleId, status: "proposed", pattern, suggestedText });
    }
  }
  return created;
}

/** Omitting `moduleId` lists promotion suggestions across ALL installed
 * Modules — the shape a generic surface needs (AI Harness K1: generic
 * surfaces no longer carry a per-module default). */
export async function listPromotionSuggestions(
  store: MemoryStore,
  scope: MemoryAuthScope,
  moduleId?: string,
  status?: PromotionStatus,
): Promise<PromotionSuggestion[]> {
  const rows = await store.retrieve(
    {
      type: "semantic",
      contentPathEquals: [
        { path: "anchor.kind", equals: PROMOTION_SUGGESTION_KIND },
        ...(moduleId ? [{ path: "anchor.moduleId", equals: moduleId }] : []),
        ...(status ? [{ path: "anchor.status", equals: status }] : []),
      ],
    },
    scope,
  );
  const suggestions: PromotionSuggestion[] = [];
  for (const row of rows) {
    const content = parseContent(row);
    if (!content) continue;
    const anchor = content["anchor"] as { status?: unknown; moduleId?: unknown } | undefined;
    suggestions.push({
      memoryId: row.id,
      moduleId: moduleId ?? (typeof anchor?.moduleId === "string" ? anchor.moduleId : "unknown"),
      status: (typeof anchor?.status === "string" ? anchor.status : "proposed") as PromotionStatus,
      pattern: content["pattern"] as unknown as DetectedPattern,
      suggestedText: typeof content["suggestedText"] === "string" ? (content["suggestedText"] as string) : "",
    });
  }
  return suggestions;
}

async function transitionPromotion(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  toStatus: PromotionStatus,
  actorUserId: string,
  nextId: () => string,
  /** K10 E2: merged into the superseded row (e.g. the acceptance stamp). */
  extraContent?: Record<string, unknown>,
): Promise<MemoryEntry> {
  const current = await store.get(suggestionMemoryId, scope);
  if (!current) throw new Error(`learning: unknown or unauthorized promotion ${suggestionMemoryId}`);
  const content = parseContent(current);
  const anchor = content?.["anchor"] as { kind?: unknown; status?: unknown; moduleId?: unknown } | undefined;
  if (!content || anchor?.kind !== PROMOTION_SUGGESTION_KIND) {
    throw new Error(`learning: memory ${suggestionMemoryId} is not a promotion suggestion`);
  }
  const head = await store.currentForLineage(
    current.organizationId,
    current.ownerUserId ?? actorUserId,
    current.subjectRecordId ?? "",
  );
  if (!head || head.id !== current.id) {
    const headAnchor = head ? (parseContent(head)?.["anchor"] as { status?: unknown } | undefined) : undefined;
    throw new Error(
      `learning: promotion ${suggestionMemoryId} is already ${typeof headAnchor?.status === "string" ? headAnchor.status : "superseded"}`,
    );
  }
  if (anchor.status !== "proposed") {
    throw new Error(`learning: promotion ${suggestionMemoryId} is already ${String(anchor.status)}`);
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
      content: JSON.stringify({ ...content, ...(extraContent ?? {}), anchor: { ...anchor, status: toStatus } }),
      sourceRefType: current.sourceRefType ?? null,
      sourceRefId: current.sourceRefId ?? null,
      confidence: current.confidence,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: actorUserId,
      ownerUserId: current.ownerUserId ?? null,
    },
  });
  if (!next) throw new Error(`learning: promotion ${suggestionMemoryId} was concurrently modified — re-read and retry`);
  return next;
}

/** The draft spec an acceptance yields — the caller materializes it as an
 * `AutomationDefinition` bound to its own agent/registry ids. */
export interface AutomationDraftSpec {
  name: string;
  description: string;
  pattern: DetectedPattern;
  moduleId: string;
  status: "draft";
  steps: AutomationDefinition["steps"];
}

/** Human accepts a promotion proposal: the lineage moves to `accepted` and a
 * DRAFT spec is returned. No Automation runs from this — the spec's status
 * is "draft" and its steps are EMPTY (a fabricated step would be a lie; the
 * Human/Capability Builder fills the draft in before an explicit governed
 * activation). */
export async function acceptAutomationDraft(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  actorUserId: string,
  nextId: () => string,
  /** K10 E2: the exact text the client rendered; stamps the acceptance. */
  shownText?: string,
): Promise<{ suggestion: MemoryEntry; draft: AutomationDraftSpec }> {
  const current = await store.get(suggestionMemoryId, scope);
  if (!current) throw new Error(`learning: unknown or unauthorized promotion ${suggestionMemoryId}`);
  const content = parseContent(current);
  const pattern = content?.["pattern"] as DetectedPattern | undefined;
  const anchor = content?.["anchor"] as { moduleId?: unknown } | undefined;
  if (!pattern) throw new Error(`learning: promotion ${suggestionMemoryId} carries no pattern`);
  const moduleId = typeof anchor?.moduleId === "string" ? anchor.moduleId : "unknown";
  const stamp = await acceptanceStamp(
    shownText,
    typeof content?.["suggestedText"] === "string" ? (content["suggestedText"] as string) : "",
  );
  const accepted = await transitionPromotion(store, scope, suggestionMemoryId, "accepted", actorUserId, nextId, stamp ? { acceptance: stamp } : undefined);
  return {
    suggestion: accepted,
    draft: {
      name: `Draft: ${pattern.action} when ${pattern.attributeKey} is ${pattern.attributeValue}`,
      description:
        `Drafted from ${pattern.count} repeated "${pattern.action}" decisions where ` +
        `${pattern.attributeKey} was "${pattern.attributeValue}". Inert until reviewed, ` +
        `given real steps, and explicitly activated.`,
      pattern,
      moduleId,
      status: "draft",
      steps: [],
    },
  };
}

/** Human rejects a promotion proposal — the pattern is never re-proposed. */
export async function rejectAutomationDraft(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  actorUserId: string,
  nextId: () => string,
): Promise<MemoryEntry> {
  return transitionPromotion(store, scope, suggestionMemoryId, "rejected", actorUserId, nextId);
}
