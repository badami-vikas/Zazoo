/**
 * Capability archetypes (roadmap-v2-universal-commons §Universal Commons +
 * §Phase 4) — the privacy-preserving network effect made concrete:
 *
 *   "Suppose many acquisition-search organizations independently develop
 *    similar document intake workflows. The Commons recognizes the common
 *    pattern and creates a reusable capability archetype. Future
 *    acquisition-search users receive a better generated organization without
 *    any previous user's private data being shared."
 *
 * Two pure halves, both Module-agnostic (light-egg rule — this file knows
 * nothing about deals or jobs):
 *
 *  - CONTRIBUTE: `generalizeLearnedPreferences` turns a organization's accepted
 *    learned preferences into `CapabilityArchetype` candidates carrying ONLY
 *    generalized fields — no ids, no evidence refs, no user-written text, no
 *    exact counts (support is banded). Every candidate is screened through
 *    the same `findOrganizationDataPaths` gate the Commons server enforces;
 *    anything personal-shaped is dropped HERE, before it could ever leave
 *    the machine. Publishing itself stays an explicit Human action.
 *
 *  - CONSUME: `seedSuggestionsFromArchetypes` lets a NEW organization start
 *    smarter — archetypes fetched from the Commons become PROPOSED learning
 *    suggestions riding the exact same lineage machinery as locally-digested
 *    patterns (same lineage key, so a local digest and an archetype seed can
 *    never duplicate each other, and a rejection suppresses both). Nothing
 *    is ever auto-accepted: suggested-then-accepted holds for knowledge that
 *    arrived from the Commons exactly as it does for locally observed
 *    patterns.
 */
import type { MemoryStore } from "../memory/memory-store.js";
import { findOrganizationDataPaths } from "../module/privacy.js";
import {
  suggestionLineageKey,
  type DetectedPattern,
  type LearnedPreference,
  type LearningSuggestion,
  type SuggestionStatus,
} from "./observation.js";

export const ARCHETYPE_SCHEMA_VERSION = 1;

/** Coarse support bands — exact repetition counts stay on the organization. */
export type ArchetypeSupportBand = "3-5" | "6-10" | "11+";

/** One generalized preference pattern as the Commons stores it. Every field
 * is generalized vocabulary; nothing identifies a organization, user, or
 * record. */
export interface CapabilityArchetype {
  schemaVersion: typeof ARCHETYPE_SCHEMA_VERSION;
  /** Deterministic slug — same pattern always yields the same name, so the
   * Commons can dedupe contributions from many organizations. */
  name: string;
  /** Generalized domain the pattern was observed in (e.g. "dealpilot" —
   * a Module id is generalized vocabulary, never organization data). */
  domain: string;
  kind: "preference_pattern";
  action: string;
  attributeKey: string;
  attributeValue: string;
  supportBand: ArchetypeSupportBand;
}

function slugSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function archetypeName(
  domain: string,
  pattern: Pick<DetectedPattern, "action" | "attributeKey" | "attributeValue">,
): string {
  return [
    "preference",
    slugSegment(domain),
    slugSegment(pattern.action),
    slugSegment(pattern.attributeKey),
    slugSegment(pattern.attributeValue),
  ].join(".");
}

export function supportBandForCount(count: number): ArchetypeSupportBand {
  if (count >= 11) return "11+";
  if (count >= 6) return "6-10";
  return "3-5";
}

/**
 * Generalize accepted learned preferences into archetype candidates.
 * Dropped (never returned): patterns whose fields trip the organization-data
 * gate (an email, uuid, phone number, or anything else personal-shaped that
 * a Module mapping accidentally let through as an attribute value), and
 * duplicates of an already-produced name. Returns candidates only — the
 * caller decides (with an explicit Human action) whether any are published.
 */
export function generalizeLearnedPreferences(
  preferences: LearnedPreference[],
  domain: string,
): CapabilityArchetype[] {
  const seen = new Set<string>();
  const candidates: CapabilityArchetype[] = [];
  for (const preference of preferences) {
    const pattern = preference.pattern;
    if (
      !pattern ||
      typeof pattern.action !== "string" || pattern.action.length === 0 ||
      typeof pattern.attributeKey !== "string" || pattern.attributeKey.length === 0 ||
      typeof pattern.attributeValue !== "string" || pattern.attributeValue.length === 0
    ) {
      continue;
    }
    const candidate: CapabilityArchetype = {
      schemaVersion: ARCHETYPE_SCHEMA_VERSION,
      name: archetypeName(domain, pattern),
      domain: slugSegment(domain),
      kind: "preference_pattern",
      action: pattern.action,
      attributeKey: pattern.attributeKey,
      attributeValue: pattern.attributeValue,
      supportBand: supportBandForCount(pattern.count ?? 0),
    };
    // The same gate the Commons server enforces, applied at the source: a
    // candidate carrying anything organization/user-shaped never even
    // becomes a candidate.
    if (findOrganizationDataPaths(candidate).length > 0) continue;
    if (seen.has(candidate.name)) continue;
    seen.add(candidate.name);
    candidates.push(candidate);
  }
  return candidates;
}

const SUPPORT_BANDS: readonly ArchetypeSupportBand[] = ["3-5", "6-10", "11+"];

/** Strict shape validation for an untrusted archetype payload (the Commons
 * server's publish body, a registry response). Throws on anything outside
 * the schema — unknown keys, wrong kinds, empty fields. */
export function parseCapabilityArchetype(value: unknown): CapabilityArchetype {
  if (typeof value !== "object" || value === null) {
    throw new Error("archetype: payload must be an object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "schemaVersion", "name", "domain", "kind", "action", "attributeKey", "attributeValue", "supportBand",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`archetype: unknown field "${key}"`);
  }
  if (record["schemaVersion"] !== ARCHETYPE_SCHEMA_VERSION) {
    throw new Error("archetype: unsupported schemaVersion");
  }
  if (record["kind"] !== "preference_pattern") throw new Error("archetype: unsupported kind");
  for (const field of ["name", "domain", "action", "attributeKey", "attributeValue"] as const) {
    const fieldValue = record[field];
    if (typeof fieldValue !== "string" || fieldValue.length === 0 || fieldValue.length > 200) {
      throw new Error(`archetype: ${field} must be a non-empty string of at most 200 characters`);
    }
  }
  if (!SUPPORT_BANDS.includes(record["supportBand"] as ArchetypeSupportBand)) {
    throw new Error("archetype: invalid supportBand");
  }
  return {
    schemaVersion: ARCHETYPE_SCHEMA_VERSION,
    name: record["name"] as string,
    domain: record["domain"] as string,
    kind: "preference_pattern",
    action: record["action"] as string,
    attributeKey: record["attributeKey"] as string,
    attributeValue: record["attributeValue"] as string,
    supportBand: record["supportBand"] as ArchetypeSupportBand,
  };
}

const SUGGESTION_KIND = "learning_suggestion";

export interface SeedFromArchetypesOptions {
  organizationId: string;
  ownerUserId: string;
  /** Module the seeded suggestions belong to (where they surface for
   * review). */
  moduleId: string;
  archetypes: CapabilityArchetype[];
  /** Annoyance cap — at most this many NEW proposals per seed run. Default 3,
   * matching the digest's cap. */
  maxSuggestions?: number;
  nextId: () => string;
  /** Same lineage-key mapper contract as `DigestOptions.lineageIdFor`. */
  lineageIdFor?: (key: string) => string;
}

/**
 * Propose suggestions from Commons archetypes — the "every new organization
 * starts smarter" half. Writes PROPOSED suggestion rows only (never a
 * preference), on the SAME lineage a local digest of the same pattern would
 * use: an existing lineage row (proposed/accepted/rejected, local or seeded)
 * suppresses the seed, so archetypes can never re-propose something the
 * Human already rejected or duplicate a local suggestion.
 */
export async function seedSuggestionsFromArchetypes(
  store: MemoryStore,
  options: SeedFromArchetypesOptions,
): Promise<LearningSuggestion[]> {
  const maxSuggestions = options.maxSuggestions ?? 3;
  const lineageIdFor = options.lineageIdFor ?? ((key: string) => key);
  const created: LearningSuggestion[] = [];
  for (const archetype of options.archetypes) {
    if (created.length >= maxSuggestions) break;
    if (archetype.kind !== "preference_pattern") continue;
    const pattern: DetectedPattern = {
      action: archetype.action,
      attributeKey: archetype.attributeKey,
      attributeValue: archetype.attributeValue,
      // No local observations back this yet — count 0 is the honest value;
      // the accept path words the preference without a count when none
      // exists.
      count: 0,
      evidenceSignalIds: [],
    };
    const lineageKey = lineageIdFor(suggestionLineageKey(options.moduleId, pattern));
    const current = await store.currentForLineage(options.organizationId, options.ownerUserId, lineageKey);
    if (current) continue;
    const suggestedText =
      `Organizations like yours often choose "${archetype.action}" when ${archetype.attributeKey} is ` +
      `"${archetype.attributeValue}". Remember this as a preference?`;
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
            kind: SUGGESTION_KIND,
            moduleId: options.moduleId,
            status: "proposed" satisfies SuggestionStatus,
            origin: "commons_archetype",
            archetypeName: archetype.name,
          },
          pattern,
          suggestedText,
        }),
        sourceRefType: "feedback",
        sourceRefId: null,
        confidence: 0.5,
        trustOrigin: "user_content",
        plane: "local",
        createdBy: "commons-archetype-seed",
        ownerUserId: options.ownerUserId,
      },
    });
    if (row) {
      created.push({
        memoryId: row.id,
        moduleId: options.moduleId,
        status: "proposed",
        pattern,
        suggestedText,
      });
    }
  }
  return created;
}
