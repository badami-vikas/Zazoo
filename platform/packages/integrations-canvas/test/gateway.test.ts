import assert from "node:assert/strict";
import test from "node:test";
import type { GuardedFetchResult } from "@bridge/net-guard";
import { CanvasApiGateway, parseNextPageUrl } from "../src/gateway.js";
import { mapCanvasAssignment, mapCanvasCourse, mapCanvasFile, mapCanvasPage } from "../src/intake.js";
import { isCanvasTokenShape, maskCanvasToken, normalizeCanvasHost } from "../src/token.js";

test('parseNextPageUrl extracts rel="next" from a Canvas multi-link header', () => {
  const header =
    '<https://wustl.instructure.com/api/v1/courses?page=1&per_page=10>; rel="current",' +
    '<https://wustl.instructure.com/api/v1/courses?page=2&per_page=10>; rel="next",' +
    '<https://wustl.instructure.com/api/v1/courses?page=1&per_page=10>; rel="first"';
  assert.equal(parseNextPageUrl(header), "https://wustl.instructure.com/api/v1/courses?page=2&per_page=10");
  assert.equal(parseNextPageUrl(undefined), undefined);
  assert.equal(parseNextPageUrl('<https://x.test/a>; rel="last"'), undefined, "no next page left");
});

test("token shape accepts Canvas shard~random tokens and nothing else", () => {
  assert.equal(isCanvasTokenShape("6078~zG8DMxtNAJCmPzcT6D6DLeFPhaXfNVaTkWf4AXW9VJVB"), true);
  assert.equal(isCanvasTokenShape("ghp_0123456789012345678901234567890123456789"), false, "a GitHub PAT is not a Canvas token");
  assert.equal(isCanvasTokenShape("6078~short"), false);
  assert.equal(maskCanvasToken("6078~zG8DMxtNAJCmPzcT6D6DLeFPhaXfNVaTkWf4AXW9VJVB").last4, "9VJVB".slice(-4));
});

test("normalizeCanvasHost strips scheme/path and rejects non-hostnames", () => {
  assert.equal(normalizeCanvasHost("wustl.instructure.com"), "wustl.instructure.com");
  assert.equal(normalizeCanvasHost("https://wustl.instructure.com/courses/1"), "wustl.instructure.com");
  assert.equal(normalizeCanvasHost("HTTP://Canvas.Example.EDU"), "canvas.example.edu");
  assert.equal(normalizeCanvasHost("not a host"), undefined);
  assert.equal(normalizeCanvasHost("localhost"), undefined, "a bare label has no dot — not an instance");
});

test("mapCanvasCourse maps fields, skips restricted/unnamed, drops Default Term", () => {
  const mapped = mapCanvasCourse({
    id: 181363,
    name: "Fall_2026.FIN.5340.01 - Advanced Corporate Finance I",
    course_code: "Fall 2026.FIN.5340.01",
    term: { name: "Fall 2026" },
    teachers: [{ display_name: "Prof. Example" }],
  });
  assert.deepEqual(mapped, {
    sourceId: "181363",
    title: "Fall_2026.FIN.5340.01 - Advanced Corporate Finance I",
    code: "Fall 2026.FIN.5340.01",
    term: "Fall 2026",
    instructor: "Prof. Example",
  });
  assert.equal(mapCanvasCourse({ id: 1, access_restricted_by_date: true }), undefined);
  assert.equal(mapCanvasCourse({ id: 2 }), undefined, "no name and no code — nothing honest to show");
  assert.equal(mapCanvasCourse({ id: 3, name: "X", term: { name: "Default Term" } })?.term, undefined);
});

test("mapCanvasAssignment maps submission state forward-only and gates grade on graded", () => {
  const graded = mapCanvasAssignment(
    {
      id: 973300,
      name: "Case write-up",
      due_at: "2026-09-02T17:00:00Z",
      submission: { workflow_state: "graded", submitted_at: "2026-09-01T12:00:00Z", entered_grade: "A-", score: 92 },
    },
    "181363",
  );
  assert.deepEqual(graded, {
    sourceId: "973300",
    courseSourceId: "181363",
    title: "Case write-up",
    dueAt: "2026-09-02T17:00:00Z",
    status: "graded",
    submittedAt: "2026-09-01T12:00:00Z",
    grade: "A-",
  });
  const unsubmitted = mapCanvasAssignment(
    { id: 1, name: "Reading", submission: { workflow_state: "unsubmitted", score: 0 } },
    "181363",
  );
  assert.equal(unsubmitted?.status, undefined, "unsubmitted never downgrades a manual status");
  assert.equal(unsubmitted?.grade, undefined, "a score on an ungraded row is a placeholder, not a grade");
  assert.equal(mapCanvasAssignment({ id: 2 }, "181363"), undefined, "unnamed assignment is skipped");
});

test("mapCanvasPage strips HTML to plain text and skips empty/untitled pages", () => {
  const mapped = mapCanvasPage(
    { url: "syllabus", title: "Syllabus", body: "<p>Office hours: <b>Tue 2-4pm</b>.</p>" },
    "181363",
  );
  assert.deepEqual(mapped, {
    sourceId: "syllabus",
    courseSourceId: "181363",
    kind: "page",
    title: "Syllabus",
    content: "Office hours: Tue 2-4pm .",
  });
  assert.equal(mapCanvasPage({ url: "blank", title: "Front Page" }, "181363"), undefined, "no body — nothing to summarize");
  assert.equal(mapCanvasPage({ url: "untitled", body: "<p>x</p>" }, "181363"), undefined, "no title");
});

test("mapCanvasFile maps display name and url, no content", () => {
  const mapped = mapCanvasFile(
    { id: 55, display_name: "Week 1 Slides.pdf", url: "https://wustl.instructure.com/files/55/download" },
    "181363",
  );
  assert.deepEqual(mapped, {
    sourceId: "55",
    courseSourceId: "181363",
    kind: "file",
    title: "Week 1 Slides.pdf",
    url: "https://wustl.instructure.com/files/55/download",
  });
  assert.equal(mapCanvasFile({ id: 1 }, "181363"), undefined, "no display_name and no filename");
});

function fakeResult(body: unknown, headers: Record<string, string> = {}, status = 200): GuardedFetchResult {
  return {
    status,
    headers,
    body: Buffer.from(JSON.stringify(body), "utf8"),
    finalUrl: "https://wustl.instructure.com/api/v1/x",
  } as GuardedFetchResult;
}

test("CanvasApiGateway paginates via Link header and sends the bearer token", async () => {
  const seen: Array<{ url: string; auth: string | undefined }> = [];
  const gateway = new CanvasApiGateway("wustl.instructure.com", "6078~testtokentesttokentesttoken", {
    fetchImpl: async (url, options) => {
      seen.push({ url, auth: (options?.headers as Record<string, string>)?.["authorization"] });
      if (url.includes("page=2")) return fakeResult([{ id: 2, name: "B" }]);
      return fakeResult([{ id: 1, name: "A" }], {
        link: '<https://wustl.instructure.com/api/v1/courses?page=2>; rel="next"',
      });
    },
  });
  const first = await gateway.fetchCourses({ perPage: 1 });
  assert.equal(first.courses[0]?.id, 1);
  assert.equal(first.nextPageToken, "https://wustl.instructure.com/api/v1/courses?page=2");
  const second = await gateway.fetchCourses({ pageToken: first.nextPageToken! });
  assert.equal(second.courses[0]?.id, 2);
  assert.equal(second.nextPageToken, undefined);
  assert.ok(seen.every((request) => request.auth === "Bearer 6078~testtokentesttokentesttoken"));
  assert.ok(seen[0]!.url.startsWith("https://wustl.instructure.com/api/v1/courses?enrollment_state=active"));
});

test("CanvasApiGateway fetches pages with body included and files metadata-only", async () => {
  const seen: string[] = [];
  const gateway = new CanvasApiGateway("wustl.instructure.com", "6078~testtokentesttokentesttoken", {
    fetchImpl: async (url) => {
      seen.push(url);
      if (url.includes("/pages")) return fakeResult([{ url: "syllabus", title: "Syllabus", body: "<p>hi</p>" }]);
      return fakeResult([{ id: 1, display_name: "Notes.pdf" }]);
    },
  });
  const pages = await gateway.fetchPages("181363", {});
  assert.equal(pages.pages[0]?.title, "Syllabus");
  const files = await gateway.fetchFiles("181363", {});
  assert.equal(files.files[0]?.display_name, "Notes.pdf");
  assert.ok(seen[0]!.startsWith("https://wustl.instructure.com/api/v1/courses/181363/pages?include[]=body"));
  assert.ok(seen[1]!.startsWith("https://wustl.instructure.com/api/v1/courses/181363/files?"));
});

test("CanvasApiGateway surfaces non-2xx as errors", async () => {
  const gateway = new CanvasApiGateway("wustl.instructure.com", "6078~testtokentesttokentesttoken", {
    fetchImpl: async () => fakeResult({ errors: [{ message: "Invalid access token." }] }, {}, 401),
  });
  await assert.rejects(() => gateway.profile(), /HTTP 401/);
});
