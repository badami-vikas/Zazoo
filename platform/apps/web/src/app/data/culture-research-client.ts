// JobPilot culture research (TASK-011, JP3B) — client-side pure helpers for
// `CultureResearchSection`. TASK-011 remediation (2026-07-18 coordinator
// final review, issue 7): the runtime page no longer renders hand-authored
// BCG culture claims — it queries the REAL `jobpilot.cultureResearch.*`
// procedures and renders whatever the API actually returns, including an
// honest empty state before research/approval exists. This module holds the
// small amount of client-side LOGIC involved (deriving a real, grounded
// claim from an already-fetched result; a tiny local pointer so a page
// refresh can re-find an in-progress or completed run) as plain, testable
// functions — the React component itself is a thin consumer of these plus
// `trpc`.
//
// IMPORTANT: nothing here stores or fabricates CONTENT. `loadStoredCultureResearchState`/
// `saveStoredCultureResearchState` persist only IDENTIFIERS (proposal/child-Run/
// parent-Run ids) so the component knows WHAT to ask the API about after a
// remount — every claim, citation, hash, and disclosure the user sees is
// fetched live from the server each time, never cached or hardcoded here.

/** A minimal storage port so this logic is unit-testable without a real
 * `window.localStorage` (and without pulling in a browser-only global at
 * import time in `node:test`). The web app wires the REAL `window.localStorage`. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CultureSourcePendingRecord {
  proposalId: string;
  childRunId: string;
  sourceId: string;
  sourceType: string;
  sourceLabel: string;
}

/** The client's own pointer to an in-progress or completed culture-research
 * run for one (organizationId, company) pair — NOT the research result itself. */
export interface StoredCultureResearchState {
  parentRunId: string;
  pending: CultureSourcePendingRecord[];
  synthesisProposalId?: string;
}

export function cultureResearchStorageKey(organizationId: string, company: string): string {
  return `bridge.jobpilot.cultureResearch.${organizationId}.${company}`;
}

function isCultureSourcePendingRecord(value: unknown): value is CultureSourcePendingRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.proposalId === 'string' && v.proposalId.length > 0 &&
    typeof v.childRunId === 'string' && v.childRunId.length > 0 &&
    typeof v.sourceId === 'string' && v.sourceId.length > 0 &&
    typeof v.sourceType === 'string' && v.sourceType.length > 0 &&
    typeof v.sourceLabel === 'string'
  );
}

/** TASK-011 remediation (2026-07-19 coordinator distributed-defects
 * RE-review, issue 12) — a FULL, deep schema validation of the cached
 * pointer, not merely a shallow "parentRunId is a string, pending is an
 * array" check. `localStorage` is untrusted, foreign-writable storage (a
 * browser extension, a stale/incompatible app version, or manual tampering
 * could all leave a shape that superficially "looks like" a pointer but
 * carries the wrong field types) — every `pending` entry's fields, and
 * `synthesisProposalId` if present, are validated before ANY of this cached
 * state is treated as actionable. A cache that fails deep validation is
 * discarded exactly like a missing one (return null), never partially
 * trusted. This cache is ALSO never actionable on its own regardless of
 * validity — the mount effect always reconciles it against the
 * server-authoritative `latestRun` query before render, per this same
 * issue's "cache is never actionable until reconciliation succeeds"
 * requirement (see `JobPilotApplicationDetail.tsx`'s `CultureResearchSection`). */
function isStoredCultureResearchState(value: unknown): value is StoredCultureResearchState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.parentRunId !== 'string' || v.parentRunId.length === 0) return false;
  if (!Array.isArray(v.pending) || !v.pending.every(isCultureSourcePendingRecord)) return false;
  if (v.synthesisProposalId !== undefined && (typeof v.synthesisProposalId !== 'string' || v.synthesisProposalId.length === 0)) return false;
  return true;
}

export function loadStoredCultureResearchState(
  storage: KeyValueStorage,
  organizationId: string,
  company: string,
): StoredCultureResearchState | null {
  const raw = storage.getItem(cultureResearchStorageKey(organizationId, company));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredCultureResearchState(parsed) ? parsed : null;
  } catch {
    return null; // corrupt/foreign value — treat as "nothing stored", never throw
  }
}

export function saveStoredCultureResearchState(
  storage: KeyValueStorage,
  organizationId: string,
  company: string,
  state: StoredCultureResearchState,
): void {
  storage.setItem(cultureResearchStorageKey(organizationId, company), JSON.stringify(state));
}

export function clearStoredCultureResearchState(storage: KeyValueStorage, organizationId: string, company: string): void {
  storage.removeItem(cultureResearchStorageKey(organizationId, company));
}

/** TASK-011 remediation (2026-07-19 coordinator distributed-defects
 * RE-review round 2, issue 8/9) — the derived quote must be a BOUNDED
 * excerpt, never the result's entire raw body. A prior version forwarded
 * `result.content` verbatim as the claim's `quote` (still trivially a real,
 * verifiable substring of the fetched result, so the server's
 * `groundClaims` check always passed) — but that meant the ENTIRE raw fetched
 * page ended up persisted as `claimText` in the approved, durable ledger row,
 * exactly the "full result body retained forever" privacy gap this slice's
 * result-expiry/purge mechanism is meant to prevent. Capping the excerpt
 * length here keeps the claim genuinely citable (a real quote, not
 * paraphrased or fabricated) while bounding how much of the raw page this
 * interim, non-human-curated extraction step can ever carry into a
 * synthesis result. */
export const MAX_DERIVED_CLAIM_SNIPPET_LENGTH = 320;

/**
 * Derives ONE real, fully-grounded "fact" claim from an already-fetched
 * result — a BOUNDED excerpt of its actual content (never the whole raw
 * body — see `MAX_DERIVED_CLAIM_SNIPPET_LENGTH`'s doc comment), the interim
 * claim-authoring step this prototype uses until a human-excerpt-picker or
 * LLM-assisted extraction exists (tracked as future work; not simulated
 * here). The `quote` is a genuine, verbatim prefix of the result's own
 * text, so the server's `groundClaims` substring + content-hash check always
 * succeeds for it — this NEVER fabricates or paraphrases content, it only
 * forwards a bounded slice of real fetched bytes back as a citable claim.
 */
export function deriveBoundedResultFactClaim(
  claimId: string,
  sourceId: string,
  result: { content: string; contentHash: string },
): { id: string; claimType: 'fact'; sourceId: string; quote: string; contentHash: string } {
  const quote =
    result.content.length > MAX_DERIVED_CLAIM_SNIPPET_LENGTH
      ? result.content.slice(0, MAX_DERIVED_CLAIM_SNIPPET_LENGTH)
      : result.content;
  return { id: claimId, claimType: 'fact', sourceId, quote, contentHash: result.contentHash };
}

/**
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects
 * RE-review round 2, issue 9) — a fetched source's result can become
 * unusable WITHOUT its status ever leaving `"fetched"`: the server purges an
 * expired result's raw `content` to `""` on read (never serving expired
 * evidence) while leaving the record's own status untouched, and the client
 * must ALSO proactively treat an result past its own `expiresAt` as
 * unusable even before the server's next lazy purge-on-read happens to run.
 * A `"fetched"` status must therefore NEVER be treated as "content
 * available" without this additional check — the caller must never render
 * fetched-success, and must never let this source ground a NEW synthesis,
 * once it is no longer usable.
 */
export function isResultUsable(result: { content: string; expiresAt: string } | null | undefined): boolean {
  if (!result) return false;
  if (result.content === '') return false;
  return new Date(result.expiresAt).getTime() > Date.now();
}
