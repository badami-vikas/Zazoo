/**
 * The engine-held governance overlay (TASK-088).
 *
 * ADR-248 made a Module's `allow`/`deny` policy engine-read, and ADR-178 makes
 * manifests immutable — which is why `module.governance.userEdited` was parsed
 * (manifest.ts) and rendered (ModuleGovernanceSection) but could never be set
 * by anything in the repo. This file is the proof of the half that was missing:
 * an overlay keyed by Organization + Module, held on the Local Plane state
 * store, resolved over the manifest's declared default, and ENFORCED — the same
 * `accounting.overrides.create` call site that ADR-248 built as its one real
 * governed action now answers to the resolved policy, not to the manifest.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { classifyPublicCloudProcedure } from "../src/deployment-boundary.js";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(88);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

/** Each case gets its own Accounting sqlite so the governed call site is real
 * rather than mocked, and its own state store so overlays never leak between
 * tests. */
async function withCaller<T>(
  operation: (caller: ReturnType<typeof makeCaller>, wiring: Wiring) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "bridge-governance-overlay-"));
  const prior = process.env.BRIDGE_ACCOUNTING_DB_PATH;
  process.env.BRIDGE_ACCOUNTING_DB_PATH = join(dir, "accounting.sqlite");
  const wiring = await buildWiring();
  try {
    return await operation(makeCaller(wiring), wiring);
  } finally {
    await wiring.close?.();
    if (prior === undefined) delete process.env.BRIDGE_ACCOUNTING_DB_PATH;
    else process.env.BRIDGE_ACCOUNTING_DB_PATH = prior;
    await rm(dir, { recursive: true, force: true });
  }
}

test("with no overlay, get() reports the manifest's declared policy and userEdited false", async () => {
  await withCaller(async (caller) => {
    const view = await caller.moduleGovernance.get({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "accounting",
    });
    assert.equal(view.userEdited, false);
    assert.ok(view.declared, "Accounting is the one Module that declares a policy");
    assert.deepEqual(view.resolved, view.declared);
    assert.ok(view.resolved?.deny.some((rule) => rule.action === "books.write.model"));
  });
});

test("a Module declaring no policy reports nothing declared — not a default-deny", async () => {
  await withCaller(async (caller) => {
    const view = await caller.moduleGovernance.get({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "relationship",
    });
    assert.equal(view.declared, null);
    assert.equal(view.resolved, null);
    assert.equal(view.userEdited, false);
  });
});

test("set() persists the overlay, sets userEdited, and never mutates the manifest", async () => {
  await withCaller(async (caller) => {
    const before = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    const manifestBefore = before.items.find((item) => item.moduleName === "accounting")?.manifest.governance;

    const saved = await caller.moduleGovernance.set({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "accounting",
      allow: [{ action: "books.read", reason: "reports may read my imported facts" }],
      deny: [{ action: "books.write", reason: "I want every write off, mine included" }],
    });
    assert.equal(saved.userEdited, true);
    assert.equal(saved.resolved?.userEdited, true);

    // Survives the round trip.
    const reread = await caller.moduleGovernance.get({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "accounting",
    });
    assert.equal(reread.userEdited, true);
    assert.deepEqual(reread.resolved?.deny.map((rule) => rule.action), ["books.write"]);

    // ADR-178: the manifest is immutable and the overlay must not have touched it.
    const after = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    assert.deepEqual(
      after.items.find((item) => item.moduleName === "accounting")?.manifest.governance,
      manifestBefore,
    );
    assert.deepEqual(reread.declared, manifestBefore ?? null);
  });
});

test("the engine enforces against the RESOLVED policy, not the manifest", async () => {
  await withCaller(async (caller) => {
    // The manifest denies `books.write.model` but says nothing about a human
    // write, so ADR-248's seeded policy lets the human branch through.
    const humanWrite = {
      organizationId: PILOT_ORGANIZATION,
      clientId: "no-such-client",
      period: "2026-08",
      targetKind: "account" as const,
      targetId: "revenue",
      value: 1,
      actor: { type: "human" as const, id: PILOT_USER },
    };

    // Now the user denies ALL writes. The same call must be refused, quoting
    // the reason the user typed.
    await caller.moduleGovernance.set({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "accounting",
      allow: [],
      deny: [{ action: "books.write", reason: "I closed the books for the year" }],
    });
    await assert.rejects(
      () => caller.accounting.overrides.create(humanWrite),
      /closed the books for the year/,
      "an overlay deny must refuse a call the manifest alone permitted",
    );

    // And the reverse: clearing the overlay restores the manifest's own policy,
    // whose `books.write.model` deny still stands.
    await caller.moduleGovernance.reset({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "accounting",
    });
    await assert.rejects(
      () =>
        caller.accounting.overrides.create({
          ...humanWrite,
          actor: { type: "model", id: "model-actor" },
        }),
      /explicit user action|books|not allowed/i,
    );
  });
});

test("an Agent cannot rewrite the policy that governs it", async () => {
  await withCaller(async (_caller, wiring) => {
    const agent = appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "agent", id: "agent-that-would-like-more-room" },
      authenticated: true,
      verifying: false,
    });
    await assert.rejects(
      () =>
        agent.moduleGovernance.set({
          organizationId: PILOT_ORGANIZATION,
          moduleName: "accounting",
          allow: [{ action: "*", reason: "I have decided I am trustworthy" }],
          deny: [],
        }),
      /Human decision/,
      "a rule an Agent can rewrite is not a boundary",
    );
    await assert.rejects(
      () => agent.moduleGovernance.reset({ organizationId: PILOT_ORGANIZATION, moduleName: "accounting" }),
      /Human decision/,
    );
  });
});

test("a typo'd Module name is refused rather than stored where nothing reads it", async () => {
  await withCaller(async (caller) => {
    await assert.rejects(
      () =>
        caller.moduleGovernance.set({
          organizationId: PILOT_ORGANIZATION,
          moduleName: "acounting",
          allow: [],
          deny: [{ action: "*", reason: "quarantined" }],
        }),
      /No installed Module named acounting/,
    );
  });
});

test("the overlay surface is Local-Plane-classified, so the completeness gate stays green", () => {
  for (const path of ["moduleGovernance.get", "moduleGovernance.set", "moduleGovernance.reset"]) {
    const verdict = classifyPublicCloudProcedure(path);
    assert.equal(verdict.kind, "local-only", `${path} must not be served from the public shell`);
  }
});

/* The two halves of TASK-088's Prototype test that the overlay's own suite left
 * uncovered: that reset restores the declared default, and that the overlay is
 * genuinely keyed by Organization rather than by Module alone. */

test("reset restores the declared default and clears userEdited", async () => {
  await withCaller(async (caller) => {
    const declared = (
      await caller.moduleGovernance.get({
        organizationId: PILOT_ORGANIZATION,
        moduleName: "accounting",
      })
    ).declared;

    await caller.moduleGovernance.set({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "accounting",
      allow: [],
      deny: [{ action: "books.read", reason: "temporarily off" }],
    });

    const afterReset = await caller.moduleGovernance.reset({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "accounting",
    });
    assert.equal(afterReset.userEdited, false);
    assert.deepEqual(afterReset.resolved, declared);

    // And it survives the round trip — reset clears the row, it does not merely
    // return the declared policy while leaving the overlay in place.
    const reread = await caller.moduleGovernance.get({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "accounting",
    });
    assert.equal(reread.userEdited, false);
    assert.deepEqual(reread.resolved, declared);
  });
});

test("the overlay is keyed by Organization + Module, so one Organization's edit does not reach another", async () => {
  await withCaller(async (caller, wiring) => {
    const OTHER_ORGANIZATION = "org-not-the-pilot";
    const namespace = "module:governance:accounting";

    // The router is single-tenant-pinned today (`assertPilotOrganization`), so a
    // second Organization cannot be driven end to end until TASK-089 lands
    // multi-Organization membership. That pin is asserted here rather than
    // worked around, and the KEY itself is proven one layer down at the store.
    await assert.rejects(
      caller.moduleGovernance.get({ organizationId: OTHER_ORGANIZATION, moduleName: "accounting" }),
      "a non-pilot Organization is refused, not silently served the pilot's policy",
    );

    await caller.moduleGovernance.set({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "accounting",
      allow: [],
      deny: [{ action: "books.read", reason: "pilot Organization only" }],
    });

    assert.ok(
      await wiring.localPlane.state.read(PILOT_ORGANIZATION, namespace),
      "the pilot Organization's overlay row exists",
    );
    assert.equal(
      await wiring.localPlane.state.read(OTHER_ORGANIZATION, namespace),
      null,
      "the same Module in another Organization has no overlay — the key is Organization + Module, not Module alone",
    );
  });
});
