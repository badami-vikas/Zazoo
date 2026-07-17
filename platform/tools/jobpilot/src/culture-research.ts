// JobPilot culture-research (JP3B, docs/raw/jobpilot-module-plan-2026-07.md; BRD JP-BRD-042).
// Pure logic + types only — no fetch, no @bridge/core dependency (this package stays framework-
// agnostic; the actual governed Skill invocation, child Agent Runs, and network fetch live in
// apps/api's wiring per the TASK-007 handoff — see
// outputs/2026-07-16-task007-agent-skill-child-run-orchestration.md's "TASK-011 handoff" section).
//
// NAMING NOTE (read the handoff's item 1 before importing this alongside @bridge/core): this
// package ALSO exports a `Skill` type (resume-schema.ts's JSON-Resume work-skill entry) —
// completely unrelated to @bridge/core's governed `Skill` interface. Nothing in this file uses or
// exports that name.

/** The fixed catalog of culture-research source TYPES JP3B names (BRD JP-BRD-042 verbatim):
 * "authorized company pages, Google reviews, Reddit, blogs, and Glassdoor — only where access and
 * terms permit." This is a closed set of source *types*; the concrete URL for a given company
 * (e.g. one company's own careers page) is supplied per-request, not hardcoded here. */
export type CultureSourceType =
  | "company_official_page"
  | "public_blog_or_press"
  | "reddit"
  | "google_reviews"
  | "glassdoor";

/** Reuse/license-intake eligibility (clean-room protocol,
 * docs/raw/clean-room-capability-research-protocol-2026-07.md; AP-008) for a source TYPE —
 * NOT a per-URL judgment. `permitted` is the ONLY eligibility that may ever reach a real fetch. */
export type CultureSourceEligibility = "permitted" | "research_only" | "do_not_use" | "not_yet_integrated";

export interface CultureSourceClassification {
  sourceType: CultureSourceType;
  eligibility: CultureSourceEligibility;
  /** Why this eligibility was assigned — always shown to the user, never silently dropped. */
  reason: string;
}

/**
 * The source-rights catalog itself (BRD §9 `source_rights`; JP3B exit criterion "inaccessible,
 * paywalled, prohibited, or ambiguous sources are skipped or stop for user/counsel permission; no
 * bypass path"). Findings recorded here came from lawful public-terms research (reuse intake,
 * AP-008) done while planning TASK-011 — no restricted source's terms were bypassed to produce
 * this table, and this table itself is the ONLY thing that may promote a source out of
 * `do_not_use`/`research_only`/`not_yet_integrated` (never a per-call override).
 */
export const CULTURE_SOURCE_CATALOG: Readonly<Record<CultureSourceType, CultureSourceClassification>> = {
  company_official_page: {
    sourceType: "company_official_page",
    eligibility: "permitted",
    reason: "Publicly published company material intended for candidates; cite briefly and link back, no bulk mirroring.",
  },
  public_blog_or_press: {
    sourceType: "public_blog_or_press",
    eligibility: "permitted",
    reason: "Public, no-login-wall coverage; attribute the author/publication, treat opinion pieces as opinion not fact.",
  },
  reddit: {
    sourceType: "reddit",
    eligibility: "research_only",
    reason:
      "Reddit's Data API requires a paid commercial OAuth contract for any product use as of 2026; unauthenticated scraping is blocked at the network level. No such contract exists — stays off until one does.",
  },
  google_reviews: {
    sourceType: "google_reviews",
    eligibility: "not_yet_integrated",
    reason:
      "Google prohibits scraping Search/Maps reviews; the only lawful path is the billed Places API (capped at 5 relevance-selected reviews). No Places API key is provisioned for this workspace yet.",
  },
  glassdoor: {
    sourceType: "glassdoor",
    eligibility: "do_not_use",
    reason:
      "Glassdoor's Terms of Service prohibit scraping and its review API is partner-only. Matches BRD verbatim: stays off with no bypass path unless a lawful partnership exists.",
  },
};

export function classifyCultureSource(sourceType: CultureSourceType): CultureSourceClassification {
  return CULTURE_SOURCE_CATALOG[sourceType];
}

/** One candidate source for one company's culture-research run — a concrete URL/label paired
 * with the source TYPE whose catalog entry decides eligibility. */
export interface CultureSourceCandidate {
  sourceType: CultureSourceType;
  sourceLabel: string;
  url: string;
}

export interface CulturePermittedSource extends CultureSourceCandidate {
  eligibility: "permitted";
}

export interface CultureSkippedSource extends CultureSourceCandidate {
  eligibility: Exclude<CultureSourceEligibility, "permitted">;
  reason: string;
}

export interface CultureSourcePlan {
  permitted: CulturePermittedSource[];
  skipped: CultureSkippedSource[];
}

/**
 * Partitions a list of candidate sources into what may actually be fetched (`permitted`) and what
 * must be skipped with a recorded reason, with ZERO network access for the skipped ones — this is
 * the "eligibility gate BEFORE Run creation" step 0 the TASK-007 handoff prescribes: a
 * `do_not_use`/`research_only`/`not_yet_integrated` source gets no child Agent Run and no fetch at
 * all, never merely a human-approval speed bump. Pure function — safe to call before any
 * pipeline/child-Run wiring exists, and unit-testable without a network.
 */
export function planCultureSources(candidates: readonly CultureSourceCandidate[]): CultureSourcePlan {
  const permitted: CulturePermittedSource[] = [];
  const skipped: CultureSkippedSource[] = [];
  for (const candidate of candidates) {
    const classification = classifyCultureSource(candidate.sourceType);
    if (classification.eligibility === "permitted") {
      permitted.push({ ...candidate, eligibility: "permitted" });
    } else {
      skipped.push({ ...candidate, eligibility: classification.eligibility, reason: classification.reason });
    }
  }
  return { permitted, skipped };
}

/** JP3B's required separation (exit criteria + BRD JP-BRD-042): a culture claim is EXACTLY one of
 * these — never blended, never silently promoted from opinion to fact. */
export type CultureClaimType = "fact" | "opinion" | "theme" | "contradiction" | "inference";

export interface CultureEvidence {
  id: string;
  claimType: CultureClaimType;
  claimText: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceType: CultureSourceType;
  /** ISO date the evidence was actually retrieved — JP3B exit: "every surfaced culture claim
   * opens its Source and retrieval date." */
  retrievedAt: string;
  /** Who said it, when available (e.g. a named reviewer + role/location). `null` is the honest
   * default — never fabricated to make a claim look more attributed than it is. */
  authorContext: string | null;
  /** True ONLY for Internal-Strategist-authored synthesis, never for anything sourced verbatim —
   * an inference must never be presented as a fact (BRD agents.Internal_Strategist invariant). */
  agentInference: boolean;
  /** For `claimType: "contradiction"` rows — the ids of the claims this one conflicts with. JP3B
   * exit: "seeded contradictory reviews remain visible rather than collapsed into false
   * consensus," so a contradiction must reference what it contradicts, not just assert conflict. */
  contradicts?: readonly string[];
}

export interface CultureEvidencePartition {
  facts: CultureEvidence[];
  opinions: CultureEvidence[];
  themes: CultureEvidence[];
  contradictions: CultureEvidence[];
  inferences: CultureEvidence[];
}

/** Groups evidence by claimType. An empty bucket (e.g. no contradictions found among only
 * Tier-1-permitted sources) is an HONEST empty result, not an error — callers must render it as
 * an explicit empty state, never fabricate a row to fill it (AP-002 no-dummy-data policy). */
export function partitionCultureEvidence(evidence: readonly CultureEvidence[]): CultureEvidencePartition {
  const partition: CultureEvidencePartition = { facts: [], opinions: [], themes: [], contradictions: [], inferences: [] };
  for (const item of evidence) {
    if (item.claimType === "inference" && !item.agentInference) {
      throw new Error(`culture-research: claim ${item.id} is typed "inference" but agentInference is false`);
    }
    if (item.agentInference && item.claimType !== "inference") {
      throw new Error(`culture-research: claim ${item.id} is agentInference but not typed "inference"`);
    }
    switch (item.claimType) {
      case "fact":
        partition.facts.push(item);
        break;
      case "opinion":
        partition.opinions.push(item);
        break;
      case "theme":
        partition.themes.push(item);
        break;
      case "contradiction":
        partition.contradictions.push(item);
        break;
      case "inference":
        partition.inferences.push(item);
        break;
    }
  }
  return partition;
}

/** The rights/access disclosure JP3B requires the user see BEFORE using any culture-informed
 * recommendation — lists every source actually used AND every source skipped with its reason, so
 * "why isn't Glassdoor here" is always an answered question, never a silent gap. */
export interface CultureSourceDisclosure {
  used: readonly { sourceLabel: string; sourceUrl: string; sourceType: CultureSourceType; retrievedAt: string }[];
  skipped: readonly { sourceLabel: string; sourceType: CultureSourceType; reason: string }[];
}

export function buildSourceDisclosure(
  usedEvidence: readonly CultureEvidence[],
  skippedSources: readonly CultureSkippedSource[],
): CultureSourceDisclosure {
  const seen = new Set<string>();
  const used: Array<CultureSourceDisclosure["used"][number]> = [];
  for (const item of usedEvidence) {
    const key = `${item.sourceType}:${item.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    used.push({ sourceLabel: item.sourceLabel, sourceUrl: item.sourceUrl, sourceType: item.sourceType, retrievedAt: item.retrievedAt });
  }
  return {
    used,
    skipped: skippedSources.map((s) => ({ sourceLabel: s.sourceLabel, sourceType: s.sourceType, reason: s.reason })),
  };
}

/**
 * Deterministic red-team guard (JP3B exit: "generated materials contain no invented personal
 * affinity, insider claim, or defamatory assertion") — mirrors evaluator.ts's cheap-deterministic-
 * gate-before-LLM-judge pattern (types.ts's `EvalVerdict` doc comment: "don't spend LLM cost
 * judging materials that fail the cheap deterministic gate first"). This is a NECESSARY, not
 * sufficient, check: it catches the clearest violations by pattern; it does not replace human
 * review of generated text.
 */
const FABRICATION_PATTERNS: readonly RegExp[] = [
  /\bi (?:personally )?know (?:someone|a friend|people) (?:who|at)\b/i,
  /\binsider (?:info|information|knowledge|source)\b/i,
  /\bguarantee(?:d)?\s+(?:you'?ll|to)?\s*(?:get|land|receive)\s+(?:the|an?)\s+(?:job|offer|interview)\b/i,
  /\bi have a personal (?:relationship|connection) with\b/i,
  /\b(?:secretly|confidentially) told me\b/i,
];

export interface FabricationCheckResult {
  clean: boolean;
  /** The matched pattern text, when unclean — surfaced so a reviewer can see exactly why. */
  violations: string[];
}

export function assertNoFabricatedAffinityOrInsiderClaim(text: string): FabricationCheckResult {
  const violations: string[] = [];
  for (const pattern of FABRICATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) violations.push(match[0]);
  }
  return { clean: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// TASK-011 remediation (2026-07-17 security review) — grounded evidence.
//
// Claims can no longer be arbitrary caller-supplied text merely time-stamped
// with a fetch. Every fact/opinion claim must carry a `quote` that is an
// EXACT substring of the immutable, server-fetched artifact it cites, AND a
// `contentHash` that must match that artifact's real (server-computed) hash —
// binding the claim to the EXACT fetched bytes, not just "some artifact
// somewhere contains this text" (two different sources could coincidentally
// share a substring; the hash makes the citation unambiguous and rejects a
// claim built against stale/superseded content). Theme/inference claims
// reference other REAL claims in the same batch (`supportingClaimIds`) rather
// than a raw quote; contradiction claims reference what they contradict
// (`contradicts`) — both are validated against the actual submitted batch
// (no dangling or self-referencing ids), and claim ids must be unique.
// ---------------------------------------------------------------------------

/** A fixed, small, server-owned cap on how many sources one culture-research
 * run may fan out to — independent of how long a caller's request list is
 * (a caller listing 500 source ids must not reserve 500x budget/child Runs). */
export const MAX_CULTURE_SOURCES_PER_RUN = 5;

/** An immutable, server-fetched artifact's content, as the grounding check
 * needs it. `contentHash` is computed by the server from the REAL fetched
 * bytes (apps/api, via node:crypto) — this module stays hash-algorithm
 * agnostic, it only compares the caller-asserted hash against this value. */
export interface CultureArtifactRef {
  sourceId: string;
  sourceType: CultureSourceType;
  sourceLabel: string;
  sourceUrl: string;
  content: string;
  contentHash: string;
  retrievedAt: string;
}

export interface GroundedClaimInput {
  id: string;
  claimType: CultureClaimType;
  /** Required verbatim substring of the cited artifact's content for
   * `fact`/`opinion` claims. Ignored for other claim types. */
  quote?: string;
  /** Required for `fact`/`opinion` — which fetched artifact this claim cites. */
  sourceId?: string;
  /** Required for `fact`/`opinion` — must equal the cited artifact's REAL
   * content hash, or the claim is rejected as stale/mismatched. */
  contentHash?: string;
  authorContext?: string | null;
  /** Required (non-empty) for `theme`/`inference` — ids of OTHER claims in
   * this same batch that substantiate the theme/inference. */
  supportingClaimIds?: readonly string[];
  /** Required (non-empty) for `contradiction` — ids of OTHER claims in this
   * batch that this one conflicts with. */
  contradicts?: readonly string[];
}

export type ClaimGroundingFailureReason =
  | "duplicate-claim-id"
  | "unknown-source"
  | "missing-quote"
  | "quote-not-found-in-artifact"
  | "content-hash-mismatch"
  | "empty-supporting-set"
  | "dangling-reference"
  | "self-reference";

export interface ClaimGroundingFailure {
  claimId: string;
  reason: ClaimGroundingFailureReason;
  detail: string;
}

export interface ClaimGroundingResult {
  ok: boolean;
  evidence: CultureEvidence[];
  failures: ClaimGroundingFailure[];
}

/**
 * Validates a batch of claims against the REAL fetched artifacts for this
 * run, and against each other (for theme/inference/contradiction
 * cross-references). Returns `ok: false` with the full set of failures if ANY
 * claim fails to ground — this is all-or-nothing per batch (a partially
 * grounded batch is not applied), matching the fail-closed posture the rest
 * of this Skill already uses (`assertNoFabricatedAffinityOrInsiderClaim`).
 */
export function groundClaims(
  claims: readonly GroundedClaimInput[],
  artifactsBySourceId: ReadonlyMap<string, CultureArtifactRef>,
): ClaimGroundingResult {
  const failures: ClaimGroundingFailure[] = [];
  const evidence: CultureEvidence[] = [];
  const seenIds = new Set<string>();
  const allIds = new Set(claims.map((c) => c.id));

  for (const claim of claims) {
    if (seenIds.has(claim.id)) {
      failures.push({ claimId: claim.id, reason: "duplicate-claim-id", detail: `duplicate claim id "${claim.id}"` });
      continue;
    }
    seenIds.add(claim.id);

    if (claim.claimType === "fact" || claim.claimType === "opinion") {
      const artifact = claim.sourceId ? artifactsBySourceId.get(claim.sourceId) : undefined;
      if (!artifact) {
        failures.push({ claimId: claim.id, reason: "unknown-source", detail: `source "${claim.sourceId ?? ""}" was not fetched in this run` });
        continue;
      }
      if (!claim.quote || claim.quote.trim().length === 0) {
        failures.push({ claimId: claim.id, reason: "missing-quote", detail: "fact/opinion claims require a quote" });
        continue;
      }
      if (claim.contentHash !== artifact.contentHash) {
        failures.push({ claimId: claim.id, reason: "content-hash-mismatch", detail: "claimed content hash does not match the fetched artifact's real hash" });
        continue;
      }
      if (!artifact.content.includes(claim.quote)) {
        failures.push({ claimId: claim.id, reason: "quote-not-found-in-artifact", detail: "quote is not a substring of the fetched artifact's content" });
        continue;
      }
      evidence.push({
        id: claim.id,
        claimType: claim.claimType,
        claimText: claim.quote,
        sourceLabel: artifact.sourceLabel,
        sourceUrl: artifact.sourceUrl,
        sourceType: artifact.sourceType,
        retrievedAt: artifact.retrievedAt,
        authorContext: claim.authorContext ?? null,
        agentInference: false,
      });
    } else if (claim.claimType === "theme" || claim.claimType === "inference") {
      const supporting = claim.supportingClaimIds ?? [];
      if (supporting.length === 0) {
        failures.push({ claimId: claim.id, reason: "empty-supporting-set", detail: "theme/inference claims require at least one supporting claim id" });
        continue;
      }
      if (supporting.includes(claim.id)) {
        failures.push({ claimId: claim.id, reason: "self-reference", detail: "a claim cannot support itself" });
        continue;
      }
      const dangling = supporting.filter((id) => !allIds.has(id));
      if (dangling.length > 0) {
        failures.push({ claimId: claim.id, reason: "dangling-reference", detail: `references unknown claim ids: ${dangling.join(", ")}` });
        continue;
      }
      evidence.push({
        id: claim.id,
        claimType: claim.claimType,
        claimText: claim.quote ?? "",
        sourceLabel: "synthesis of cited claims",
        sourceUrl: "",
        sourceType: "company_official_page",
        retrievedAt: new Date().toISOString(),
        authorContext: claim.authorContext ?? null,
        agentInference: claim.claimType === "inference",
      });
    } else {
      // contradiction
      const refs = claim.contradicts ?? [];
      if (refs.length === 0) {
        failures.push({ claimId: claim.id, reason: "empty-supporting-set", detail: "contradiction claims require at least one contradicted claim id" });
        continue;
      }
      if (refs.includes(claim.id)) {
        failures.push({ claimId: claim.id, reason: "self-reference", detail: "a claim cannot contradict itself" });
        continue;
      }
      const dangling = refs.filter((id) => !allIds.has(id));
      if (dangling.length > 0) {
        failures.push({ claimId: claim.id, reason: "dangling-reference", detail: `contradicts unknown claim ids: ${dangling.join(", ")}` });
        continue;
      }
      evidence.push({
        id: claim.id,
        claimType: "contradiction",
        claimText: claim.quote ?? "",
        sourceLabel: "synthesis of cited claims",
        sourceUrl: "",
        sourceType: "company_official_page",
        retrievedAt: new Date().toISOString(),
        authorContext: claim.authorContext ?? null,
        agentInference: false,
        contradicts: refs,
      });
    }
  }

  return { ok: failures.length === 0, evidence, failures };
}
