/**
 * K8 browser capture over the real `buildWiring()` composition root
 * (AI Harness K8, TASK-052) — the contract:
 *
 *  - a visit captures ONLY when the flight is on, "browser" consent is
 *    explicitly on, AND the domain matches the allowlist without matching
 *    the denylist (default-deny: the empty policy captures nothing);
 *  - declined captures return a structured verdict, never an error — the
 *    extension is a background caller and must not be tempted into retry
 *    loops;
 *  - the written Memory holds domain+title only; a URL cannot arrive (the
 *    schema has no url field and a path-bearing "domain" is refused);
 *  - the write is idempotent per extension-minted visitId;
 *  - the domain policy is edited loudly (typos refused, never silently
 *    dropped) and only by a Human identity.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

const ORG = PILOT_ORGANIZATION;
const AT = "2026-08-11T09:30:00.000Z";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(88);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring, identity?: { type: "user" | "agent"; id: string }) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: identity ?? { type: "user", id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

async function browserSignals(wiring: Wiring) {
  const rows = await wiring.memoryStore.retrieve(
    { limit: 200 },
    { organizationId: ORG, userId: PILOT_USER },
  );
  return rows.filter((row) => {
    try {
      const value = JSON.parse(row.content) as { anchor?: { kind?: string; moduleId?: string } };
      return value.anchor?.kind === "observed_signal" && value.anchor.moduleId === "browser";
    } catch {
      return false;
    }
  });
}

test("consent OFF: a visit is declined with a structured verdict and writes nothing", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.browser.setPolicy({
      organizationId: ORG,
      allowlist: ["github.com"],
      denylist: [],
    });
    const result = await caller.learning.capture.browser.visit({
      organizationId: ORG,
      visitId: "0b7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e",
      domain: "github.com",
      title: "Bridge PRs",
      visitedAt: AT,
    });
    assert.deepEqual(result, { captured: false, verdict: "consent_off" });
    assert.equal((await browserSignals(wiring)).length, 0, "consent off writes nothing");
  } finally {
    await wiring.close();
  }
});

test("allowlisted visit → one domain+title Memory; denylisted and unlisted → nothing; URL-shaped input is refused", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "browser", enabled: true });
    await caller.learning.capture.browser.setPolicy({
      organizationId: ORG,
      allowlist: ["github.com", "google.com"],
      denylist: ["mail.google.com"],
    });

    const SECRET_PATH = "/manishsbhoopalam/secret-repo/pull/42?token=XYZZY";
    const captured = await caller.learning.capture.browser.visit({
      organizationId: ORG,
      visitId: "1b7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e",
      domain: "GitHub.com",
      title: "Pull request #42",
      visitedAt: AT,
    });
    assert.deepEqual(captured, { captured: true, verdict: "captured" });

    const denied = await caller.learning.capture.browser.visit({
      organizationId: ORG,
      visitId: "2b7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e",
      domain: "mail.google.com",
      title: "Inbox (3) - dev.bridge.ai",
      visitedAt: AT,
    });
    assert.deepEqual(denied, { captured: false, verdict: "denylisted" });

    const unlisted = await caller.learning.capture.browser.visit({
      organizationId: ORG,
      visitId: "3b7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e",
      domain: "news.ycombinator.com",
      title: "Hacker News",
      visitedAt: AT,
    });
    assert.deepEqual(unlisted, { captured: false, verdict: "not_allowlisted" });

    // A "domain" carrying URL structure fails hostname normalization — the
    // full URL cannot arrive through this schema even deliberately.
    const urlShaped = await caller.learning.capture.browser.visit({
      organizationId: ORG,
      visitId: "4b7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e",
      domain: `github.com${SECRET_PATH}`,
      title: "smuggle attempt",
      visitedAt: AT,
    });
    assert.equal(urlShaped.captured, false);

    const rows = await browserSignals(wiring);
    assert.equal(rows.length, 1, "exactly the allowlisted visit wrote a Memory");
    const value = JSON.parse(rows[0]!.content) as {
      anchor: { action: string };
      recordKind: string;
      attributes: Record<string, string>;
    };
    assert.equal(value.recordKind, "visit");
    assert.equal(value.anchor.action, "browse");
    assert.equal(value.attributes.domain, "github.com", "domain stored normalized");
    assert.equal(value.attributes.title, "Pull request #42");
    assert.ok(!rows[0]!.content.includes(SECRET_PATH), "no URL/path/token anywhere in the row");
    assert.ok(!rows[0]!.content.includes("ycombinator"), "denied domains never touch storage");
  } finally {
    await wiring.close();
  }
});

test("idempotent per visitId: a retried POST is 'duplicate' and the store still holds one row", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "browser", enabled: true });
    await caller.learning.capture.browser.setPolicy({
      organizationId: ORG,
      allowlist: ["linear.app"],
      denylist: [],
    });
    const visit = {
      organizationId: ORG,
      visitId: "5b7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e",
      domain: "linear.app",
      title: "BRI-321 K8 browser capture",
      visitedAt: AT,
    };
    assert.equal((await caller.learning.capture.browser.visit(visit)).verdict, "captured");
    assert.deepEqual(await caller.learning.capture.browser.visit(visit), {
      captured: false,
      verdict: "duplicate",
    });
    assert.equal((await browserSignals(wiring)).length, 1);
  } finally {
    await wiring.close();
  }
});

test("the kill switch silences the browser source like every other", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "browser", enabled: true });
    await caller.learning.capture.browser.setPolicy({
      organizationId: ORG,
      allowlist: ["github.com"],
      denylist: [],
    });
    await caller.learning.capture.setPaused({ organizationId: ORG, paused: true });
    const result = await caller.learning.capture.browser.visit({
      organizationId: ORG,
      visitId: "6b7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e",
      domain: "github.com",
      title: "paused",
      visitedAt: AT,
    });
    assert.deepEqual(result, { captured: false, verdict: "consent_off" });
    assert.equal((await browserSignals(wiring)).length, 0);
    // The policy query tells the extension to go dormant.
    const policy = await caller.learning.capture.browser.policy({ organizationId: ORG });
    assert.equal(policy.capturing, false);
    assert.equal(policy.paused, true);
  } finally {
    await wiring.close();
  }
});

test("setPolicy refuses typos loudly, refuses non-Human identities, and normalizes entries", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.learning.capture.browser.setPolicy({
          organizationId: ORG,
          allowlist: ["https://github.com/pulls"],
          denylist: [],
        }),
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === "BAD_REQUEST" &&
        error.message.includes("https://github.com/pulls"),
      "a URL-shaped entry is refused with the offending entry named",
    );
    const agentCaller = makeCaller(wiring, { type: "agent", id: PILOT_USER });
    await assert.rejects(
      () =>
        agentCaller.learning.capture.browser.setPolicy({
          organizationId: ORG,
          allowlist: ["github.com"],
          denylist: [],
        }),
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
      "policy edits are Human-only",
    );
    const stored = await caller.learning.capture.browser.setPolicy({
      organizationId: ORG,
      allowlist: ["GitHub.COM.", "github.com"],
      denylist: ["Mail.Google.com"],
    });
    assert.deepEqual(stored, { allowlist: ["github.com"], denylist: ["mail.google.com"] });
    const policy = await caller.learning.capture.browser.policy({ organizationId: ORG });
    assert.deepEqual(policy.allowlist, ["github.com"]);
    assert.deepEqual(policy.denylist, ["mail.google.com"]);
  } finally {
    await wiring.close();
  }
});

test("flight OFF: the visit path fails closed with PRECONDITION_FAILED", async () => {
  const wiring = await buildWiring({});
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.learning.capture.browser.visit({
          organizationId: ORG,
          visitId: "7b7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e",
          domain: "github.com",
          title: "flight off",
          visitedAt: AT,
        }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
    assert.equal((await browserSignals(wiring)).length, 0);
  } finally {
    await wiring.close();
  }
});
