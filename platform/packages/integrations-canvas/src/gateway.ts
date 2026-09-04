/**
 * CanvasApiGateway — the REAL egress adapter. Binds the CanvasGateway port to
 * a Canvas instance's REST v1 API over @bridge/net-guard's `guardedFetch`
 * (DNS-pinned SSRF guard, bounded redirects, bounded response size). This is
 * the ONLY file that talks to a Canvas instance; everything upstream is
 * governed by the `academics.syncCanvas` Skill. Unlike GitHub there is no
 * single API origin — each institution runs its own host, so the factory
 * binds a (host, token) pair.
 */
import { guardedFetch, type GuardedFetchResult } from "@bridge/net-guard";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 4_000_000;
const DEFAULT_PER_PAGE = 100;
const USER_AGENT = "Bridge-Academics";

type GuardedFetchFn = (url: string, options?: Parameters<typeof guardedFetch>[1]) => Promise<GuardedFetchResult>;

export interface CanvasProfile {
  id: number;
  name: string;
}

export interface CanvasCoursePayload {
  id: number;
  name?: string;
  course_code?: string;
  /** Present (with most other fields absent) on date-restricted enrollments. */
  access_restricted_by_date?: boolean;
  term?: { name?: string } | null;
  teachers?: Array<{ display_name?: string }>;
}

export interface CanvasSubmissionPayload {
  workflow_state?: string; // unsubmitted | submitted | pending_review | graded
  submitted_at?: string | null;
  entered_grade?: string | null;
  score?: number | null;
}

export interface CanvasAssignmentPayload {
  id: number;
  name?: string;
  due_at?: string | null;
  points_possible?: number | null;
  submission?: CanvasSubmissionPayload | null;
}

/** A Canvas Wiki Page — syllabi, readings, and instructions live here as
 * RCE-authored HTML. `body` is present only when the list call asks for it
 * (`include[]=body`); a page fetched without it is metadata-only. */
export interface CanvasPagePayload {
  page_id?: number;
  url: string;
  title?: string;
  body?: string | null;
  updated_at?: string;
}

/** A Canvas course File — metadata only. Bridge does not download or parse
 * file bytes (PDFs, slides): that is a separate, unbuilt capability. */
export interface CanvasFilePayload {
  id: number;
  display_name?: string;
  filename?: string;
  url?: string;
  "content-type"?: string;
  size?: number;
  updated_at?: string;
}

export interface PageOpts {
  perPage?: number;
  /** Opaque next-page URL from a previous result's `nextPageToken`. */
  pageToken?: string;
}

export interface FetchCoursesResult {
  courses: CanvasCoursePayload[];
  nextPageToken?: string;
}

export interface FetchAssignmentsResult {
  assignments: CanvasAssignmentPayload[];
  nextPageToken?: string;
}

export interface FetchPagesResult {
  pages: CanvasPagePayload[];
  nextPageToken?: string;
}

export interface FetchFilesResult {
  files: CanvasFilePayload[];
  nextPageToken?: string;
}

export interface CanvasGateway {
  /** Liveness + identity check — proves the token works on this instance. */
  profile(): Promise<CanvasProfile>;
  /** The owner's active-enrollment courses, with term and teacher names. */
  fetchCourses(opts: PageOpts): Promise<FetchCoursesResult>;
  /** A course's assignments with the owner's own submission state. */
  fetchAssignments(courseId: string, opts: PageOpts): Promise<FetchAssignmentsResult>;
  /** A course's Wiki Pages, with body content included (syllabi, readings). */
  fetchPages(courseId: string, opts: PageOpts): Promise<FetchPagesResult>;
  /** A course's Files — metadata only, no byte download. */
  fetchFiles(courseId: string, opts: PageOpts): Promise<FetchFilesResult>;
}

export interface CanvasGatewayFactory {
  forConnection(host: string, accessToken: string): CanvasGateway;
}

/** Extracts the `rel="next"` URL from a Canvas `Link` response header (same
 * RFC 5988 shape GitHub uses). Pure — exported for direct unit testing. */
export function parseNextPageUrl(linkHeader: string | string[] | undefined): string | undefined {
  const value = Array.isArray(linkHeader) ? linkHeader.join(", ") : linkHeader;
  if (!value) return undefined;
  for (const part of value.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (match) return match[1];
  }
  return undefined;
}

class CanvasApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CanvasApiError";
  }
}

export class CanvasApiGateway implements CanvasGateway {
  #origin: string;
  #token: string;
  #fetchImpl: GuardedFetchFn;

  constructor(host: string, accessToken: string, deps: { fetchImpl?: GuardedFetchFn } = {}) {
    this.#origin = `https://${host}`;
    this.#token = accessToken;
    this.#fetchImpl = deps.fetchImpl ?? guardedFetch;
  }

  async #getJson<T>(url: string): Promise<{ body: T; nextPageToken: string | undefined }> {
    const response = await this.#fetchImpl(url, {
      headers: {
        authorization: `Bearer ${this.#token}`,
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxBytes: DEFAULT_MAX_BYTES,
      maxRedirects: 0,
      allowedRedirectOrigins: [this.#origin],
    });
    if (response.status < 200 || response.status >= 300) {
      throw new CanvasApiError(response.status, `Canvas API ${url} returned HTTP ${response.status}`);
    }
    const body = JSON.parse(response.body.toString("utf8")) as T;
    const nextPageToken = parseNextPageUrl(response.headers["link"] as string | string[] | undefined);
    return { body, nextPageToken };
  }

  async profile(): Promise<CanvasProfile> {
    const { body } = await this.#getJson<{ id: number; name: string }>(`${this.#origin}/api/v1/users/self`);
    return { id: body.id, name: body.name };
  }

  async fetchCourses(opts: PageOpts): Promise<FetchCoursesResult> {
    const url =
      opts.pageToken ??
      `${this.#origin}/api/v1/courses?enrollment_state=active&include[]=term&include[]=teachers&per_page=${opts.perPage ?? DEFAULT_PER_PAGE}`;
    const { body, nextPageToken } = await this.#getJson<CanvasCoursePayload[]>(url);
    return { courses: body, ...(nextPageToken ? { nextPageToken } : {}) };
  }

  async fetchAssignments(courseId: string, opts: PageOpts): Promise<FetchAssignmentsResult> {
    const url =
      opts.pageToken ??
      `${this.#origin}/api/v1/courses/${encodeURIComponent(courseId)}/assignments?include[]=submission&per_page=${opts.perPage ?? DEFAULT_PER_PAGE}`;
    const { body, nextPageToken } = await this.#getJson<CanvasAssignmentPayload[]>(url);
    return { assignments: body, ...(nextPageToken ? { nextPageToken } : {}) };
  }

  async fetchPages(courseId: string, opts: PageOpts): Promise<FetchPagesResult> {
    const url =
      opts.pageToken ??
      `${this.#origin}/api/v1/courses/${encodeURIComponent(courseId)}/pages?include[]=body&per_page=${opts.perPage ?? DEFAULT_PER_PAGE}`;
    const { body, nextPageToken } = await this.#getJson<CanvasPagePayload[]>(url);
    return { pages: body, ...(nextPageToken ? { nextPageToken } : {}) };
  }

  async fetchFiles(courseId: string, opts: PageOpts): Promise<FetchFilesResult> {
    const url =
      opts.pageToken ??
      `${this.#origin}/api/v1/courses/${encodeURIComponent(courseId)}/files?per_page=${opts.perPage ?? DEFAULT_PER_PAGE}`;
    const { body, nextPageToken } = await this.#getJson<CanvasFilePayload[]>(url);
    return { files: body, ...(nextPageToken ? { nextPageToken } : {}) };
  }
}

/** Resolves a CanvasApiGateway for a caller-supplied instance host + token. */
export class LiveCanvasGatewayFactory implements CanvasGatewayFactory {
  forConnection(host: string, accessToken: string): CanvasGateway {
    return new CanvasApiGateway(host, accessToken);
  }
}
