// JobPilot culture research (TASK-011, JP3B) — client-side pure helpers for
// `CultureResearchSection`. TASK-011 remediation (2026-07-18 coordinator
// final review, issue 7): the runtime page no longer renders hand-authored
// BCG culture claims — it queries the REAL `jobpilot.cultureResearch.*`
// procedures and renders whatever the API actually returns, including an
// honest empty state before research/approval exists. This module holds the
// small amount of client-side LOGIC involved (deriving a real, grounded
// claim from an already-fetched artifact; a tiny local pointer so a page
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
 * run for one (workspaceId, company) pair — NOT the research result itself. */
export interface StoredCultureResearchState {
  parentRunId: string;
  pending: CultureSourcePendingRecord[];
  synthesisProposalId?: string;
}

export function cultureResearchStorageKey(workspaceId: string, company: string): string {
  return `bridge.jobpilot.cultureResearch.${workspaceId}.${company}`;
}

function isStoredCultureResearchState(value: unknown): value is StoredCultureResearchState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.parentRunId === 'string' && Array.isArray(v.pending);
}

export function loadStoredCultureResearchState(
  storage: KeyValueStorage,
  workspaceId: string,
  company: string,
): StoredCultureResearchState | null {
  const raw = storage.getItem(cultureResearchStorageKey(workspaceId, company));
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
  workspaceId: string,
  company: string,
  state: StoredCultureResearchState,
): void {
  storage.setItem(cultureResearchStorageKey(workspaceId, company), JSON.stringify(state));
}

export function clearStoredCultureResearchState(storage: KeyValueStorage, workspaceId: string, company: string): void {
  storage.removeItem(cultureResearchStorageKey(workspaceId, company));
}

/**
 * Derives ONE real, fully-grounded "fact" claim from an already-fetched
 * artifact's ENTIRE actual content — the interim claim-authoring step this
 * prototype uses until a human-excerpt-picker or LLM-assisted extraction
 * exists (tracked as future work; not simulated here). The `quote` is the
 * artifact's own verbatim text, so the server's `groundClaims` substring +
 * content-hash check always succeeds for it — this NEVER fabricates or
 * paraphrases content, it only forwards real fetched bytes back as a citable
 * claim.
 */
export function deriveFullArtifactFactClaim(
  claimId: string,
  sourceId: string,
  artifact: { content: string; contentHash: string },
): { id: string; claimType: 'fact'; sourceId: string; quote: string; contentHash: string } {
  return { id: claimId, claimType: 'fact', sourceId, quote: artifact.content, contentHash: artifact.contentHash };
}
