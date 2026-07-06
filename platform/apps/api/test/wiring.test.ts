/**
 * `buildPersistentPorts` / `buildInMemoryPorts` (All fixes.md section 1's `wiring.ts`
 * god-composition-root P0, feeding Phase 2 item 8) — proves each factory produces the
 * correct, fully-typed port set for its mode, with no `let`-sprawl reassignment, and
 * that the two ports which are still honest-lies in persistent mode (the ledger's
 * residency guarantee, and DealPilot's `ToolCaptureStore`) log a loud warning at boot
 * instead of silently pretending to be real.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCanonicalIdentityStore, DrizzleCanonicalIdentityStore } from "@bridge/db";
import { InMemoryLedger, InMemoryRoleStore } from "@bridge/core";
import { buildInMemoryPorts, buildPersistentPorts } from "../src/wiring.js";

/** A syntactically-valid Postgres URL that is never actually connected to: postgres-js's
 * client is lazy (no TCP connection until a query runs), so constructing/closing it is
 * safe without a live database — see packages/db/src/client.ts. */
const DUMMY_POSTGRES_URL = "postgres://dummy_user:dummy_pass@127.0.0.1:1/dummy_bridge_test";

function withCapturedWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

test("buildInMemoryPorts: returns a fully in-memory, seeded port set with no DB dependency", async () => {
  const ports = await buildInMemoryPorts({ localDir: undefined });
  try {
    assert.ok(ports.roles instanceof InMemoryRoleStore, "roles should be the in-memory store");
    assert.ok(ports.ledger instanceof InMemoryLedger, "ledger should be the in-memory ledger");
    assert.ok(
      ports.canonical instanceof InMemoryCanonicalIdentityStore,
      "canonical identity should be the in-memory fake in this mode",
    );
    assert.ok(ports.memory, "in-memory mode must expose the raw governance stores for dev seeding");
    assert.ok(ports.memory!.roles instanceof InMemoryRoleStore);
    // Seeded governance: the Google egress/intake agents are pre-authorized (seedGovernance).
    assert.ok(ports.memory!.agents.scope.size > 0, "seedGovernance should have populated agent scopes");
    // Workspace CRUD is a real DrizzleWorkspaceStore even in in-memory mode (bound to
    // the LOCAL pglite plane, not a governance in-memory port).
    assert.equal(typeof ports.workspaceStore.createWorkspace, "function");
  } finally {
    await ports.closeDb();
  }
});

test("buildPersistentPorts: binds canonical identity to the REAL DrizzleCanonicalIdentityStore (the fixed lie)", () => {
  const { result: ports } = withCapturedWarnings(() => buildPersistentPorts({ url: DUMMY_POSTGRES_URL }));
  try {
    assert.ok(
      ports.canonical instanceof DrizzleCanonicalIdentityStore,
      "canonical identity must be the real Drizzle-backed store once DATABASE_URL is set — " +
        "this is the lie this fix actually closes (was InMemoryCanonicalIdentityStore unconditionally)",
    );
    assert.equal(ports.memory, undefined, "persistent mode must not expose in-memory-only governance stores");
  } finally {
    void ports.closeDb();
  }
});

test("buildPersistentPorts: logs a loud, specific warning for the ledger-residency gap it does NOT close", () => {
  const { warnings } = withCapturedWarnings(() => buildPersistentPorts({ url: DUMMY_POSTGRES_URL }));
  const hit = warnings.find((w) => w.includes("ledger residency") || w.includes("ledger MUST"));
  assert.ok(hit, `expected a boot warning naming the ledger residency gap; got: ${JSON.stringify(warnings)}`);
  assert.match(hit!, /Phase 1 item 7/, "warning should point at the tracked, still-open decision item");
});

test("buildPersistentPorts: logs a loud, specific warning for DealPilot's ToolCaptureStore honest-lie", () => {
  const { warnings } = withCapturedWarnings(() => buildPersistentPorts({ url: DUMMY_POSTGRES_URL }));
  const hit = warnings.find((w) => w.includes("ToolCaptureStore"));
  assert.ok(hit, `expected a boot warning naming the ToolCaptureStore gap; got: ${JSON.stringify(warnings)}`);
  assert.match(hit!, /Phase 3 item 11b/, "warning should point at the tracked, still-open backlog item");
});
