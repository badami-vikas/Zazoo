/**
 * `buildPersistentPorts` / `buildInMemoryPorts` (All fixes.md section 1's `wiring.ts`
 * god-composition-root P0, feeding Phase 2 item 8) — proves each factory produces the
 * correct, fully-typed port set for its mode, with no `let`-sprawl reassignment.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createLocalDb,
  DrizzleAgentStore,
  DrizzleAutomationRegistry,
  DrizzleAutomationRunRecorder,
  InMemoryCanonicalIdentityStore,
  DrizzleCanonicalIdentityStore,
  DrizzleEvalStore,
  DrizzlePolicyParamStore,
  DrizzleGoalTaskStore,
  DrizzleSkillManifestRegistry,
  DrizzleChildAgentRunStore,
  DrizzleLedgerStore,
  DrizzleModuleStore,
  ensureInternalStrategistGovernance,
  ensureLearningAgentGovernance,
  schema,
} from "@bridge/db";
import {
  InMemoryAutomationRegistry,
  InMemoryAutomationRunRecorder,
  InMemoryChildAgentRunStore,
  InMemoryGoalTaskStore,
  InMemoryLedger,
  InMemoryModuleStore,
  InMemoryRoleStore,
  InMemorySkillManifestRegistry,
} from "@bridge/core";
import { createPgliteLocalPlane } from "@bridge/local";
import {
  buildInMemoryPorts,
  buildPersistentPorts,
  GOVERNED_SKILL_MANIFEST_CATALOG,
  INTERNAL_STRATEGIST_AGENT,
  INTERNAL_STRATEGIST_ROLE,
  LEARNING_AGENT,
  LEARNING_ROLE,
  PILOT_USER,
  PILOT_ORGANIZATION,
} from "../src/wiring.js";

/** A syntactically-valid Postgres URL that is never actually connected to: postgres-js's
 * client is lazy (no TCP connection until a query runs), so constructing/closing it is
 * safe without a live database — see packages/db/src/client.ts. */
const DUMMY_POSTGRES_URL = "postgres://test_fixture_user:test_fixture_pass@127.0.0.1:1/test_fixture_bridge_test";

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
    assert.ok(ports.automationRegistry instanceof InMemoryAutomationRegistry);
    assert.ok(ports.automationRunRecorder instanceof InMemoryAutomationRunRecorder);
    assert.ok(ports.moduleStore instanceof InMemoryModuleStore);
    assert.ok(
      ports.canonical instanceof InMemoryCanonicalIdentityStore,
      "canonical identity should be the in-memory fake in this mode",
    );
    assert.ok(ports.memory, "in-memory mode must expose the raw governance stores for dev seeding");
    assert.ok(ports.memory!.roles instanceof InMemoryRoleStore);
    // Seeded governance: the Google egress/intake agents are pre-authorized (seedGovernance).
    assert.ok(ports.memory!.agents.scope.size > 0, "seedGovernance should have populated agent scopes");
    // Organization CRUD is a real DrizzleOrganizationStore even in in-memory mode (bound to
    // the LOCAL pglite plane, not a governance in-memory port).
    assert.equal(typeof ports.organizationStore.createOrganization, "function");
  } finally {
    await ports.closeDb();
  }
});

test("buildInMemoryPorts: file-backed relational and private Local Plane stores share one root safely", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-local-plane-root-"));
  const plane = await createPgliteLocalPlane({ dataDir: dir });
  let ports: Awaited<ReturnType<typeof buildInMemoryPorts>> | undefined;
  try {
    await plane.graph.recordExternal({
      organizationId: "test_fixture_organization",
      source: "test_fixture_source",
      sourceRecordId: "test_fixture_record",
      entityType: "test_fixture_event",
      entityId: "test_fixture_entity",
      createdAt: "2026-07-18T00:00:00.000Z",
    });

    ports = await buildInMemoryPorts({ localDir: dir });
    assert.equal(
      await plane.graph.hasExternal(
        "test_fixture_organization",
        "test_fixture_source",
        "test_fixture_record",
      ),
      true,
    );
    assert.equal(typeof ports.organizationStore.createOrganization, "function");
    assert.ok(ports.automationRegistry instanceof DrizzleAutomationRegistry);
    assert.ok(ports.automationRunRecorder instanceof DrizzleAutomationRunRecorder);
    assert.ok(ports.moduleStore instanceof DrizzleModuleStore);
  } finally {
    await ports?.closeDb();
    await plane.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildInMemoryPorts: resumes Relation decision ordering above persisted local materialization", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-relation-sequence-floor-"));
  const seeded = await createLocalDb({ dataDir: dir });
  let organizationId = "";
  let userId = "";
  try {
    const [organization] = await seeded.db
      .insert(schema.organizations)
      .values({ name: "test_fixture_relation_sequence_organization" })
      .returning({ id: schema.organizations.id });
    const [user] = await seeded.db
      .insert(schema.users)
      .values({ email: "test_fixture_relation_sequence@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(organization);
    assert.ok(user);
    organizationId = organization.id;
    userId = user.id;
    await seeded.db.insert(schema.edges).values({
      organizationId,
      ownerUserId: userId,
      srcType: "signal",
      srcId: "52000000-0000-4000-8000-000000000001",
      dstType: "event",
      dstId: "52000000-0000-4000-8000-000000000002",
      edgeType: "source_event",
      decisionLedgerId: "52000000-0000-4000-8000-000000000003",
      decisionSequence: 41,
      decisionAt: new Date("2026-07-17T00:00:00.000Z"),
    });

  } finally {
    await seeded.close();
  }

  const ports = await buildInMemoryPorts({ localDir: dir });
  try {
    const entry = await ports.ledger.append({
      id: "52000000-0000-4000-8000-000000000004",
      organizationId,
      actorType: "user",
      actorId: userId,
      action: "read",
      resourceType: "signal",
      inputs: {},
      userDecision: null,
      policyResults: [],
      createdAt: "2026-07-17T00:00:01.000Z",
    });
    assert.equal(entry.appendSequence, 42);
  } finally {
    await ports.closeDb();
  }
});

test("buildInMemoryPorts: file-backed mode persists approved ledger decisions across restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-relation-ledger-restart-"));
  const seeded = await createLocalDb({ dataDir: dir });
  try {
    await seeded.db.insert(schema.organizations).values({
      id: PILOT_ORGANIZATION,
      name: "test_fixture_relation_ledger_restart_organization",
    });
    await seeded.db.insert(schema.users).values({
      id: PILOT_USER,
      email: "test_fixture_relation_ledger_restart@example.com",
    });
  } finally {
    await seeded.close();
  }

  let first = await buildInMemoryPorts({ localDir: dir });
  try {
    assert.ok(first.ledger instanceof DrizzleLedgerStore);
    const proposal = await first.ledger.append({
      id: "53000000-0000-4000-8000-000000000001",
      organizationId: PILOT_ORGANIZATION,
      actorType: "user",
      actorId: PILOT_USER,
      action: "write",
      resourceType: "relation",
      inputs: { kind: "relationship_signal_evidence" },
      userDecision: null,
      policyResults: [],
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    await first.ledger.append({
      id: "53000000-0000-4000-8000-000000000002",
      organizationId: PILOT_ORGANIZATION,
      actorType: "user",
      actorId: PILOT_USER,
      action: "write",
      resourceType: "relation",
      inputs: proposal.inputs,
      proposedOutput: proposal.inputs,
      userDecision: "approve",
      policyResults: [],
      refLedgerId: proposal.id,
      createdAt: "2026-07-17T00:00:01.000Z",
    });
  } finally {
    await first.closeDb();
  }

  first = await buildInMemoryPorts({ localDir: dir });
  try {
    assert.equal(
      (await first.ledger.decisionFor(
        "53000000-0000-4000-8000-000000000001",
      ))?.id,
      "53000000-0000-4000-8000-000000000002",
    );
  } finally {
    await first.closeDb();
    rmSync(dir, { recursive: true, force: true });
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
    // ADR-168/ADR-169 — both of these were InMemory in BOTH modes, and both
    // silently disabled the capability promotion gate rather than loosening it:
    // an amnesiac eval store meant approve never found a baseline to compare
    // against, and a defaults-only param store meant it compared against
    // thresholds the Organization never chose. Pinned here so a regression to
    // the in-memory fake is a red test, not a quiet re-opening of the gate.
    assert.ok(
      ports.evalStore instanceof DrizzleEvalStore,
      "eval history must be Drizzle-backed — an in-memory eval store makes capability.approve skip its comparison entirely after any restart",
    );
    assert.ok(
      ports.policyParams instanceof DrizzlePolicyParamStore,
      "policy params must be Drizzle-backed — a defaults-only store silently ignores the Organization's own promotion thresholds",
    );
    assert.equal(ports.memory, undefined, "persistent mode must not expose in-memory-only governance stores");
    assert.equal(typeof ports.ensureOutreachGovernance, "function");
  } finally {
    void ports.closeDb();
  }
});

test("buildPersistentPorts: does not report the resolved ledger-residency gap", () => {
  const { warnings } = withCapturedWarnings(() => buildPersistentPorts({ url: DUMMY_POSTGRES_URL }));
  const hit = warnings.find((w) => w.includes("ledger residency") || w.includes("ledger MUST"));
  assert.equal(hit, undefined, `resolved ledger residency gap must not be reported: ${JSON.stringify(warnings)}`);
});

test("buildPersistentPorts: does not report the resolved DealPilot ModuleCaptureStore gap", () => {
  const { warnings } = withCapturedWarnings(() => buildPersistentPorts({ url: DUMMY_POSTGRES_URL }));
  const hit = warnings.find((warning) => warning.includes("ModuleCaptureStore"));
  assert.equal(hit, undefined, `resolved ModuleCaptureStore gap must not be reported: ${JSON.stringify(warnings)}`);
});

test("buildPersistentPorts: exposes ensureInternalStrategistGovernance (TASK-007 persistent-mode governance seed hook)", () => {
  // Structural-only: postgres-js is lazy (no TCP until a query runs — see the
  // DUMMY_POSTGRES_URL doc comment above), so we assert the hook is WIRED
  // (present, callable-shaped) without invoking it against an unreachable DB.
  // buildInMemoryPorts correctly has NO such hook — seedGovernance covers that
  // mode synchronously instead (see buildWiring's call site).
  const { result: persistentPorts } = withCapturedWarnings(() => buildPersistentPorts({ url: DUMMY_POSTGRES_URL }));
  try {
    assert.equal(typeof persistentPorts.ensureInternalStrategistGovernance, "function");
  } finally {
    void persistentPorts.closeDb();
  }
});

test("buildPersistentPorts: exposes ensureGovernanceAgentGovernance and ensureCapabilityBuilderGovernance (AGS3 durable-boundary hooks)", () => {
  const { result: persistentPorts } = withCapturedWarnings(() => buildPersistentPorts({ url: DUMMY_POSTGRES_URL }));
  try {
    assert.equal(typeof persistentPorts.ensureGovernanceAgentGovernance, "function");
    assert.equal(typeof persistentPorts.ensureCapabilityBuilderGovernance, "function");
  } finally {
    void persistentPorts.closeDb();
  }
});

test("buildInMemoryPorts: has no ensureInternalStrategistGovernance hook (seedGovernance covers in-memory mode instead)", async () => {
  const ports = await buildInMemoryPorts({ localDir: undefined });
  try {
    assert.equal(ports.ensureInternalStrategistGovernance, undefined);
  } finally {
    await ports.closeDb();
  }
});

test("buildInMemoryPorts: goalTasks/skillManifests/childAgentRuns are in-memory, and the full governed Skill catalog is pre-registered", async () => {
  const ports = await buildInMemoryPorts({ localDir: undefined });
  try {
    assert.ok(ports.goalTasks instanceof InMemoryGoalTaskStore);
    assert.ok(ports.skillManifests instanceof InMemorySkillManifestRegistry);
    assert.ok(ports.childAgentRuns instanceof InMemoryChildAgentRunStore);
    // Every code-declared manifest in GOVERNED_SKILL_MANIFEST_CATALOG is present —
    // in-memory mode registers the SAME list buildPersistentPorts seeds to the DB.
    for (const manifest of GOVERNED_SKILL_MANIFEST_CATALOG) {
      assert.ok(
        ports.skillManifests.forSkill(manifest.organizationId, manifest.skillId).length > 0,
        `expected "${manifest.skillId}" to be pre-registered in in-memory mode`,
      );
    }
    // No ensureSkillManifestCatalog hook in this mode — nothing to seed to a DB.
    assert.equal(ports.ensureSkillManifestCatalog, undefined);
  } finally {
    await ports.closeDb();
  }
});

test("persistent governance provisioning grants culture-research authority to Learning and Internal Strategist", async () => {
  const { db, close } = await createLocalDb();
  try {
    await db.insert(schema.users).values({ id: PILOT_USER, email: "persistent-governance@test.invalid" });
    await db.insert(schema.organizations).values({ id: PILOT_ORGANIZATION, name: "Persistent governance test" });

    await ensureLearningAgentGovernance(db, {
      organizationId: PILOT_ORGANIZATION,
      userId: PILOT_USER,
      agentId: LEARNING_AGENT,
      roleId: LEARNING_ROLE,
      permissionId: "b0000000-0000-4000-a000-0000000009c2",
    });
    await ensureInternalStrategistGovernance(db, {
      organizationId: PILOT_ORGANIZATION,
      userId: PILOT_USER,
      agentId: INTERNAL_STRATEGIST_AGENT,
      roleId: INTERNAL_STRATEGIST_ROLE,
      permissionId: "b0000000-0000-4000-a000-0000000009c3",
    });

    const agents = new DrizzleAgentStore(db);
    assert.deepEqual(await agents.capabilityScope(LEARNING_AGENT), [
      "signal:write",
      "event:write",
      "external:fetch:read",
    ]);
    assert.equal(await agents.dataScope(LEARNING_AGENT), "all");
    assert.ok((await agents.allowedSkills(LEARNING_AGENT)).includes("jobpilot.researchCultureSource"));

    assert.deepEqual(await agents.capabilityScope(INTERNAL_STRATEGIST_AGENT), [
      "signal:write",
      "record:read",
      "record:write",
    ]);
    assert.equal(await agents.dataScope(INTERNAL_STRATEGIST_AGENT), "all");
    assert.deepEqual(await agents.allowedSkills(INTERNAL_STRATEGIST_AGENT), [
      "stageStrategicRecommendation",
      "jobpilot.synthesizeCultureProfile",
      "task-manager.ledger-projection",
      "task-manager.create-task",
      // ADR-181 junction 1 — the Strategist may say a capability should exist.
      // It holds no draft or review Skill: deciding what to build and building
      // it are separate Agents on purpose.
      "capability.recommendBuild",
    ]);
  } finally {
    await close();
  }
});

test("buildPersistentPorts: goalTasks/skillManifests/childAgentRuns are the real Drizzle-backed stores, and ensureSkillManifestCatalog is wired", () => {
  const { result: persistentPorts } = withCapturedWarnings(() => buildPersistentPorts({ url: DUMMY_POSTGRES_URL }));
  try {
    assert.ok(persistentPorts.goalTasks instanceof DrizzleGoalTaskStore);
    assert.ok(persistentPorts.skillManifests instanceof DrizzleSkillManifestRegistry);
    assert.ok(persistentPorts.childAgentRuns instanceof DrizzleChildAgentRunStore);
    assert.equal(typeof persistentPorts.ensureSkillManifestCatalog, "function");
  } finally {
    void persistentPorts.closeDb();
  }
});
