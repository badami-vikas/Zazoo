/**
 * K8 extension pipeline (AI Harness K8, TASK-052) — the contract:
 *
 *  - the manifest STRUCTURALLY excludes private windows (incognito
 *    "not_allowed") and holds no content-reading permissions — the
 *    prototype test's "absent, not filtered" is an assertion over the
 *    manifest, not over runtime behavior;
 *  - non-http(s) schemes never capture; the URL is reduced to a bare
 *    hostname before any payload exists, and the payload has no url field;
 *  - the verdict is @bridge/core's own default-deny/deny-wins function, so
 *    the extension can never report a domain the API would refuse;
 *  - a dormant policy (unconfigured, unreachable, consent off) reports
 *    nothing; the deduper turns page-load chatter into visits.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  buildVisitPayload,
  decideVisit,
  dormantPolicy,
  extractCaptureDomain,
  VisitDeduper,
  VISIT_DEDUPE_WINDOW_MS,
} from "../src/capture.js";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const CAPTURING = {
  capturing: true,
  allowlist: ["github.com", "google.com"],
  denylist: ["mail.google.com"],
};

test("structural: the manifest declines incognito and holds no content-reading capability", () => {
  const manifest = JSON.parse(readFileSync(resolve(PKG_ROOT, "manifest.json"), "utf8")) as {
    incognito?: string;
    permissions?: string[];
    host_permissions?: string[];
    content_scripts?: unknown;
  };
  // Private windows: the capture path is ABSENT there, not filtered —
  // Chrome refuses to run this extension in incognito profiles at all.
  assert.equal(manifest.incognito, "not_allowed");
  // No scripting, no debugger, no webRequest, no content scripts: the
  // extension cannot read page content even if it wanted to. `tabs` (url +
  // title metadata), `storage` (config), `alarms` (policy refresh) is the
  // whole capability surface.
  assert.deepEqual([...(manifest.permissions ?? [])].sort(), ["alarms", "storage", "tabs"]);
  assert.equal(manifest.content_scripts, undefined);
  // Host access is the local Bridge API only — no web origins.
  for (const host of manifest.host_permissions ?? []) {
    assert.match(host, /^http:\/\/(localhost|127\.0\.0\.1)\//, `non-local host permission: ${host}`);
  }
});

test("extractCaptureDomain: http(s) URLs reduce to a bare hostname; everything else is null", () => {
  assert.equal(
    extractCaptureDomain("https://GitHub.com:8443/manishsbhoopalam/repo/pull/42?token=XYZZY#files"),
    "github.com",
  );
  assert.equal(extractCaptureDomain("http://docs.google.com/document/d/abc123/edit"), "docs.google.com");
  for (const url of [
    "chrome://settings/passwords",
    "chrome-extension://abcdef/popup.html",
    "about:blank",
    "file:///Users/m/tax-return.pdf",
    "devtools://devtools/bundled/inspector.html",
    "javascript:alert(1)",
    "not a url",
    "",
  ]) {
    assert.equal(extractCaptureDomain(url), null, `must not capture: ${url}`);
  }
});

test("decideVisit: dormant reports nothing, ever; the live policy is default-deny with deny-wins", () => {
  assert.deepEqual(decideVisit(dormantPolicy(), "https://github.com/pulls"), {
    report: false,
    reason: "not_capturing",
  });
  assert.deepEqual(decideVisit(CAPTURING, "https://github.com/manishsbhoopalam?tab=repos"), {
    report: true,
    domain: "github.com",
  });
  assert.deepEqual(decideVisit(CAPTURING, "https://docs.google.com/spreadsheets/d/xyz"), {
    report: true,
    domain: "docs.google.com",
  });
  assert.deepEqual(decideVisit(CAPTURING, "https://mail.google.com/mail/u/0/#inbox"), {
    report: false,
    reason: "denylisted",
  });
  assert.deepEqual(decideVisit(CAPTURING, "https://news.ycombinator.com/"), {
    report: false,
    reason: "not_allowlisted",
  });
  assert.deepEqual(decideVisit(CAPTURING, "chrome://history/"), {
    report: false,
    reason: "not_http",
  });
});

test("the visit payload carries domain+title only — no url field can exist on the wire", () => {
  const payload = buildVisitPayload({
    organizationId: "org-1",
    visitId: "11111111-2222-4333-8444-555555555555",
    domain: "github.com",
    title: `  Fix auth bug ${"x".repeat(400)}`,
    visitedAt: "2026-08-11T09:30:00.000Z",
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    "domain",
    "organizationId",
    "title",
    "visitId",
    "visitedAt",
  ]);
  assert.equal(payload.title.length, 300, "title clamps to the server's limit");
  assert.ok(payload.title.startsWith("Fix auth bug"), "title trims before clamping");
});

test("the deduper sends one visit per (tab, domain, title) per window", () => {
  const deduper = new VisitDeduper();
  const t0 = 1_000_000;
  assert.equal(deduper.shouldSend(7, "github.com", "PR #42", t0), true);
  assert.equal(deduper.shouldSend(7, "github.com", "PR #42", t0 + 5_000), false, "same page settles");
  assert.equal(deduper.shouldSend(7, "github.com", "PR #43", t0 + 6_000), true, "a new title is a new visit");
  assert.equal(deduper.shouldSend(8, "github.com", "PR #43", t0 + 6_000), true, "tabs are independent");
  assert.equal(
    deduper.shouldSend(7, "github.com", "PR #43", t0 + 6_000 + VISIT_DEDUPE_WINDOW_MS),
    true,
    "the window expires",
  );
  deduper.forget(8);
  assert.equal(deduper.shouldSend(8, "github.com", "PR #43", t0 + 7_000), true, "a closed tab forgets");
});
