/**
 * OpenAlex author-identity resolution (TASK-070 follow-on).
 *
 * OpenAlex is a free, no-auth academic identity graph that already folds in
 * ORCID (`author.orcid`) and, via its `last_known_institutions`, the same
 * affiliation signal Crossref/ORCID would separately supply. Reuse intake:
 * calling ORCID's and Crossref's APIs as SEPARATE clients for this step would
 * mostly re-fetch data OpenAlex already aggregates, for three times the
 * network calls and three response shapes to parse — not a second decision,
 * just more code for the same fact. Kept as a thin fetch wrapper (no SDK
 * exists for this; the request is one GET with a query string) rather than a
 * dependency, per the task's own guidance.
 *
 * ponytail: single-source (OpenAlex only). Upgrade path if OpenAlex misses a
 * speaker ORCID has but OpenAlex hasn't indexed yet: add a direct ORCID
 * `pub.orcid.org/v3.0/expanded-search` fallback when `resolveOpenAlexAuthor`
 * returns null, same injected-fetchJson shape.
 *
 * No I/O here — `fetchJson` is caller-supplied so this file needs no network
 * access to test. apps/api wires a `fetchJson` built on `guardedFetch`
 * (`@bridge/net-guard`), which is the only place server code may reach the
 * network from.
 */

export interface OpenAlexAuthorMatch {
  openAlexId: string;
  displayName: string;
  orcid?: string;
  affiliation?: string;
}

interface OpenAlexAuthorApiRow {
  id?: string;
  display_name?: string;
  orcid?: string;
  last_known_institutions?: { display_name?: string }[];
}

interface OpenAlexAuthorsResponse {
  results?: OpenAlexAuthorApiRow[];
}

export type FetchJson = (url: string) => Promise<unknown>;

function isOpenAlexAuthorsResponse(value: unknown): value is OpenAlexAuthorsResponse {
  return typeof value === "object" && value !== null && "results" in value;
}

/**
 * Resolve one speaker's name (+ optional affiliation, used only to break ties
 * among same-name results) against OpenAlex's author search. Returns the
 * top result, or `null` on no match / any fetch failure — resolution is
 * best-effort; a failed lookup still leaves the name-only draft to review.
 */
export async function resolveOpenAlexAuthor(
  name: string,
  affiliation: string | undefined,
  fetchJson: FetchJson,
): Promise<OpenAlexAuthorMatch | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const url = `https://api.openalex.org/authors?search=${encodeURIComponent(trimmed)}&per-page=5`;
  let body: unknown;
  try {
    body = await fetchJson(url);
  } catch {
    return null;
  }
  if (!isOpenAlexAuthorsResponse(body) || !Array.isArray(body.results) || body.results.length === 0) {
    return null;
  }

  const affiliationLower = affiliation?.trim().toLowerCase();
  const withAffiliation = affiliationLower
    ? body.results.find((row) =>
        row.last_known_institutions?.some((inst) => inst.display_name?.toLowerCase().includes(affiliationLower)),
      )
    : undefined;
  const chosen = withAffiliation ?? body.results[0]!;
  if (!chosen.id || !chosen.display_name) return null;

  const institution = chosen.last_known_institutions?.[0]?.display_name;
  return {
    openAlexId: chosen.id,
    displayName: chosen.display_name,
    ...(chosen.orcid ? { orcid: chosen.orcid } : {}),
    ...(institution ? { affiliation: institution } : {}),
  };
}
