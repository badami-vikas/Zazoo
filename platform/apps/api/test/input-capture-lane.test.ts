/**
 * K11 input capture over the real `buildWiring()` composition root
 * (AI Harness K11, TASK-054, ADR-239, AP-157) — the API-level contract.
 *
 * The core suites (`@bridge/core`'s `input-capture.test.ts` and
 * `input-capture.redteam.test.ts`) pin the pure boundary. These tests pin what
 * the SERVER does with it, which is a different claim and the one that matters
 * for a shell that has been patched, downgraded, or replaced:
 *
 *  - the server RE-DISTILS every burst through the same core gate, so a caller
 *    that lies about `fieldRole` or targets a denylisted app cannot widen what
 *    is stored;
 *  - a declined burst returns a structured verdict, never an error — the
 *    provider is a background caller and must not be tempted into retry loops;
 *  - `captured` and `recorded` are distinct: a suppressed burst records a
 *    no-content marker, and reporting it as "captured" would make this lane lie
 *    about the one thing it exists to be honest about;
 *  - a suppressed burst leaks NO volume signal — two secrets of very different
 *    lengths must persist byte-identically, because a length is a brute-force
 *    hint;
 *  - the write is idempotent per provider-minted burstId;
 *  - only the user's own Human identity may report their own typing.
 *
 * Every assertion below is removal-fails: delete the guard it names and it
 * breaks.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

const ORG = PILOT_ORGANIZATION;
const AT = "2026-08-16T14:30:00.000Z";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1101);
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

interface StoredSignal {
  anchor?: { kind?: string; moduleId?: string };
  recordId?: string;
  attributes?: Record<string, string>;
}

async function inputRows(wiring: Wiring): Promise<{ raw: string; value: StoredSignal }[]> {
  const rows = await wiring.memoryStore.retrieve(
    { limit: 200 },
    { organizationId: ORG, userId: PILOT_USER },
  );
  const out: { raw: string; value: StoredSignal }[] = [];
  for (const row of rows) {
    try {
      const value = JSON.parse(row.content) as StoredSignal;
      if (value.anchor?.kind === "observed_signal" && value.anchor.moduleId === "input") {
        out.push({ raw: row.content, value });
      }
    } catch {
      // not a signal row
    }
  }
  return out;
}

interface BurstInput {
  organizationId: string;
  burstId: string;
  appName: string;
  appBundleId: string;
  fieldRole: "content_ok" | "secure" | "undeterminable";
  text: string;
  keyCount: number;
  typedAt: string;
}

function burst(burstId: string, over: Partial<BurstInput> = {}): BurstInput {
  return {
    organizationId: ORG,
    burstId,
    appName: "Editor",
    appBundleId: "com.example.editor",
    fieldRole: "content_ok",
    text: "buy milk and bread",
    keyCount: 18,
    typedAt: AT,
    ...over,
  };
}

async function enableInput(wiring: Wiring) {
  await makeCaller(wiring).learning.capture.setSource({
    organizationId: ORG,
    source: "input",
    enabled: true,
  });
}

test("consent OFF declines with a structured verdict and writes nothing", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const result = await makeCaller(wiring).learning.capture.input.burst(
      burst("a0000000-0000-4000-8000-000000000001"),
    );
    assert.deepEqual(result, { captured: false, recorded: false, verdict: "consent_off" });
    assert.equal((await inputRows(wiring)).length, 0, "consent off writes nothing");
  } finally {
    await wiring.close();
  }
});

test("a denylisted app emits NOTHING even when the caller claims a clear field", async () => {
  // Removal-fails on the server-side re-distillation: a patched shell that
  // reports `content_ok` for 1Password must still store nothing. A bank or a
  // password manager must not even reveal that typing happened.
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    await enableInput(wiring);
    const result = await makeCaller(wiring).learning.capture.input.burst(
      burst("a0000000-0000-4000-8000-000000000002", {
        appName: "1Password",
        appBundleId: "com.1password.1password",
        fieldRole: "content_ok",
        text: "master-password",
        keyCount: 15,
      }),
    );
    assert.deepEqual(result, { captured: false, recorded: false, verdict: "denylisted" });
    assert.equal((await inputRows(wiring)).length, 0, "denylisted apps leave no trace at all");
  } finally {
    await wiring.close();
  }
});

test("a secure field records a marker that is NOT reported as captured", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    await enableInput(wiring);
    const result = await makeCaller(wiring).learning.capture.input.burst(
      burst("a0000000-0000-4000-8000-000000000003", {
        appName: "Mail",
        appBundleId: "com.apple.mail",
        fieldRole: "secure",
        text: "hunter22",
        keyCount: 8,
      }),
    );
    // removal-fails: conflating `captured` with `recorded` re-introduces the lie.
    assert.equal(result.captured, false, "a secure field is never 'captured'");
    assert.equal(result.recorded, true, "but a no-content marker IS recorded");
    assert.equal(result.verdict, "suppressed");
    assert.equal(result.suppressionReason, "secure_field");

    const rows = await inputRows(wiring);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row);
    assert.ok(!row.raw.includes("hunter22"), "the typed secret is absent from the stored row");
    assert.equal(row.value.attributes?.disposition, "suppressed");
    assert.equal(
      row.value.attributes?.keyCount,
      undefined,
      "no volume facet at all — any band is a password-length hint",
    );
  } finally {
    await wiring.close();
  }
});

test("two secrets of very different lengths persist IDENTICALLY (no length leak)", async () => {
  // The leak the adversarial pass found: "typed 8 characters in a secure field"
  // publishes a password's length into a durable, inspectable Memory row, which
  // materially narrows a brute-force space.
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    await enableInput(wiring);
    const caller = makeCaller(wiring);
    await caller.learning.capture.input.burst(
      burst("a0000000-0000-4000-8000-000000000004", {
        appBundleId: "com.apple.mail",
        appName: "Mail",
        fieldRole: "secure",
        text: "ab",
        keyCount: 2,
      }),
    );
    await caller.learning.capture.input.burst(
      burst("a0000000-0000-4000-8000-000000000005", {
        appBundleId: "com.apple.mail",
        appName: "Mail",
        fieldRole: "secure",
        text: "a".repeat(64),
        keyCount: 64,
      }),
    );
    const rows = await inputRows(wiring);
    assert.equal(rows.length, 2);
    // Everything except the provider-minted burst id must match exactly.
    const facets = rows.map((row) => JSON.stringify(row.value.attributes));
    assert.equal(facets[0], facets[1], "a 2-char and a 64-char secret are indistinguishable");
  } finally {
    await wiring.close();
  }
});

test("an undeterminable field fails closed — unknown is sensitive", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    await enableInput(wiring);
    const result = await makeCaller(wiring).learning.capture.input.burst(
      burst("a0000000-0000-4000-8000-000000000006", {
        appBundleId: "com.example.unknown",
        appName: "SomeApp",
        fieldRole: "undeterminable",
        text: "maybe-a-password",
        keyCount: 16,
      }),
    );
    assert.equal(result.captured, false);
    assert.equal(result.verdict, "suppressed");
    assert.equal(result.suppressionReason, "undeterminable_field");
    const rows = await inputRows(wiring);
    assert.ok(!rows[0]?.raw.includes("maybe-a-password"));
  } finally {
    await wiring.close();
  }
});

test("a clear field is captured, and the stored row still carries no typed text", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    await enableInput(wiring);
    const result = await makeCaller(wiring).learning.capture.input.burst(
      burst("a0000000-0000-4000-8000-000000000007", {
        text: "pay with 4111111111111111 today",
        keyCount: 31,
      }),
    );
    assert.equal(result.captured, true);
    assert.equal(result.recorded, true);
    assert.equal(result.verdict, "captured");

    const rows = await inputRows(wiring);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row);
    assert.equal(row.value.attributes?.disposition, "captured");
    assert.equal(row.value.attributes?.keyCount, "short", "counts are bucketed, never tallied");
    // The signal is a FACET row: the card number cannot be there, and neither
    // can the surrounding prose. See the ADR-239 note in TASKS.md — the
    // redacted content has no persisted home today.
    assert.ok(!row.raw.includes("4111111111111111"), "a card number never persists");
    assert.ok(!row.raw.includes("pay with"), "typed prose is not in the signal row");
  } finally {
    await wiring.close();
  }
});

test("the write is idempotent per provider-minted burstId", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    await enableInput(wiring);
    const caller = makeCaller(wiring);
    const payload = burst("a0000000-0000-4000-8000-000000000008");
    const first = await caller.learning.capture.input.burst(payload);
    const second = await caller.learning.capture.input.burst(payload);
    assert.equal(first.verdict, "captured");
    assert.deepEqual(second, { captured: false, recorded: false, verdict: "duplicate" });
    assert.equal((await inputRows(wiring)).length, 1, "a replay does not double-write");
  } finally {
    await wiring.close();
  }
});

test("only a Human identity may report a human's own typing", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    await enableInput(wiring);
    const agent = makeCaller(wiring, { type: "agent", id: PILOT_USER });
    await assert.rejects(
      () => agent.learning.capture.input.burst(burst("a0000000-0000-4000-8000-000000000009")),
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
    );
    assert.equal((await inputRows(wiring)).length, 0);
  } finally {
    await wiring.close();
  }
});
