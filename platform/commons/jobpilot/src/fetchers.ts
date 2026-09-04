import type { SourceQuery } from "@bridge/sourcing";

// The HTTP half of connectors.ts. Those factories have always taken an injected
// `fetcher` and — until now — nothing in the repo supplied a real one, so the
// Greenhouse/Ashby/Lever connectors could only ever run against test doubles.
// This module is that missing supplier: one small function per ATS that hits the
// public, unauthenticated board endpoint and normalizes the response into the
// field names `processJobCandidate` already reads (company, title, location,
// url, isRemote, descriptionKeywords).
//
// Deliberately built on global `fetch` (Node 20+) rather than an HTTP client
// dependency — three GETs and a JSON parse do not justify one.
//
// What these endpoints do NOT carry: an application deadline. Every row produced
// here has `deadline: null`, and that is permanent, not a backfill gap. See
// mba-targets.ts for where deadlines actually come from (ADR-265).

/** A normalized posting, shaped to the payload keys the pipeline consumes. */
export interface FetchedPosting extends Record<string, unknown> {
  company: string;
  title: string;
  location?: string;
  url?: string;
  isRemote?: boolean;
  sourceRecordId?: string;
  /** ISO instant the board last touched the posting — the only freshness
   * signal these feeds give. NOT a deadline; do not treat it as one. */
  updatedAt?: string;
}

/** Bounded so one hung board cannot stall a whole scheduled sweep. */
const REQUEST_TIMEOUT_MS = 10_000;

export class BoardFetchError extends Error {
  constructor(
    readonly board: string,
    readonly slug: string,
    readonly status: number | null,
    cause?: unknown,
  ) {
    super(`${board} board "${slug}" failed (${status ?? "network"})`);
    this.name = "BoardFetchError";
    if (cause !== undefined) this.cause = cause;
  }
}

async function getJson(url: string, board: string, slug: string): Promise<unknown> {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { accept: "application/json" } });
  } catch (err) {
    throw new BoardFetchError(board, slug, null, err);
  }
  // A 404 here is the NORMAL case, not an exception: board slugs cannot be
  // enumerated from any ATS, so a catalog entry is always a guess that may have
  // gone stale when a company renamed or migrated. Callers are expected to
  // record the failure against the source and carry on with the others.
  if (!response.ok) throw new BoardFetchError(board, slug, response.status);
  try {
    return await response.json();
  } catch (err) {
    throw new BoardFetchError(board, slug, response.status, err);
  }
}

function isRemote(location: string | undefined): boolean | undefined {
  if (!location) return undefined;
  return /\bremote\b/i.test(location);
}

/** Drops entries missing a title — a posting we cannot name is not a posting we
 * can score, dedupe, or show, and a blank card is worse than a missing one. */
function compact(postings: Array<FetchedPosting | null>): FetchedPosting[] {
  return postings.filter((p): p is FetchedPosting => p !== null && p.title.trim().length > 0);
}

/** Greenhouse job boards: `boards-api.greenhouse.io/v1/boards/{slug}/jobs`.
 * `content=false` keeps the response to metadata — the full descriptions are
 * megabytes per board and nothing downstream reads them yet. */
export function greenhouseFetcher(slug: string, company: string) {
  return async (_query: SourceQuery): Promise<FetchedPosting[]> => {
    const data = await getJson(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=false`,
      "greenhouse",
      slug,
    );
    const jobs = (data as { jobs?: unknown }).jobs;
    if (!Array.isArray(jobs)) return [];
    return compact(
      jobs.map((raw) => {
        const j = raw as Record<string, unknown>;
        const location = (j["location"] as { name?: string } | undefined)?.name;
        const posting: FetchedPosting = { company, title: String(j["title"] ?? "") };
        if (location) posting.location = location;
        if (j["absolute_url"]) posting.url = String(j["absolute_url"]);
        if (j["id"] != null) posting.sourceRecordId = String(j["id"]);
        if (j["updated_at"]) posting.updatedAt = String(j["updated_at"]);
        const remote = isRemote(location);
        if (remote !== undefined) posting.isRemote = remote;
        return posting;
      }),
    );
  };
}

/** Lever postings: `api.lever.co/v0/postings/{slug}?mode=json`. Flat array,
 * `categories.location`, epoch-millis `createdAt`. */
export function leverFetcher(slug: string, company: string) {
  return async (_query: SourceQuery): Promise<FetchedPosting[]> => {
    const data = await getJson(
      `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
      "lever",
      slug,
    );
    if (!Array.isArray(data)) return [];
    return compact(
      data.map((raw) => {
        const j = raw as Record<string, unknown>;
        const categories = j["categories"] as Record<string, unknown> | undefined;
        const location = categories?.["location"] ? String(categories["location"]) : undefined;
        const posting: FetchedPosting = { company, title: String(j["text"] ?? "") };
        if (location) posting.location = location;
        if (j["hostedUrl"]) posting.url = String(j["hostedUrl"]);
        if (j["id"]) posting.sourceRecordId = String(j["id"]);
        const created = j["createdAt"];
        if (typeof created === "number") posting.updatedAt = new Date(created).toISOString();
        const remote = isRemote(location);
        if (remote !== undefined) posting.isRemote = remote;
        return posting;
      }),
    );
  };
}

/** Ashby's public board API is a POST/GraphQL-ish endpoint rather than a plain
 * GET like the other two — the one place the three ATSs genuinely differ. */
export function ashbyFetcher(slug: string, company: string) {
  return async (_query: SourceQuery): Promise<FetchedPosting[]> => {
    const data = await getJson(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
      "ashby",
      slug,
    );
    const jobs = (data as { jobs?: unknown }).jobs;
    if (!Array.isArray(jobs)) return [];
    return compact(
      jobs.map((raw) => {
        const j = raw as Record<string, unknown>;
        const location = j["location"] ? String(j["location"]) : undefined;
        const posting: FetchedPosting = { company, title: String(j["title"] ?? "") };
        if (location) posting.location = location;
        if (j["jobUrl"]) posting.url = String(j["jobUrl"]);
        if (j["id"]) posting.sourceRecordId = String(j["id"]);
        if (j["publishedAt"]) posting.updatedAt = String(j["publishedAt"]);
        const remote = j["isRemote"];
        if (typeof remote === "boolean") posting.isRemote = remote;
        else {
          const inferred = isRemote(location);
          if (inferred !== undefined) posting.isRemote = inferred;
        }
        return posting;
      }),
    );
  };
}
