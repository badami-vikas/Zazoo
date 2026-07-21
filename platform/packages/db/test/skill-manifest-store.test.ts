/**
 * DrizzleSkillManifestRegistry + seedSkillManifests — round-trip coverage
 * against a real pglite-backed Postgres. Proves: (1) the code-declared
 * catalog seeds idempotently (re-seeding the SAME manifests is a no-op
 * update, never a duplicate row — the unique (skill_id, version) constraint
 * plus the seed's own upsert logic), (2) `refresh()` + `forSkill`/`all` read
 * back the seeded catalog with every field intact, (3) a registry read
 * before `refresh()` fails loud rather than silently returning an empty
 * catalog (which would look identical to "no manifest registered" and
 * incorrectly fail closed every governed skill request).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleSkillManifestRegistry, seedSkillManifests, schema } from "../src/index.js";
import type { SkillManifest } from "@bridge/core";

function fixtureManifest(organizationId: string, overrides: Partial<SkillManifest> = {}): SkillManifest {
  const base: SkillManifest = {
    organizationId,
    skillId: "test.fixture.skill",
    version: "1.0.0",
    goalTypes: ["relationship.learning"],
    taskTypes: ["relationship.learning.recommend"],
    permissions: ["signal:write"],
    plane: "cloud",
    dataScopes: ["all"],
    riskBand: "advisory",
    evalVersion: "1.0.0",
  };
  return Object.assign(base, overrides);
}

async function seedOrganization(
  db: Awaited<ReturnType<typeof createLocalDb>>["db"],
): Promise<string> {
  const [organization] = await db
    .insert(schema.organizations)
    .values({ name: "test_fixture_ws_skill_manifest" })
    .returning({ id: schema.organizations.id });
  assert.ok(organization);
  return organization.id;
}

test("skill manifest store: seedSkillManifests + refresh round-trips a full manifest", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    await seedSkillManifests(db, [fixtureManifest(organizationId, { budget: { maxCallsPerDay: 10 }, defaultAgents: ["learning"], childRunPolicy: "allowed" })]);

    const registry = new DrizzleSkillManifestRegistry(db);
    await registry.refresh();

    const manifests = registry.forSkill(organizationId, "test.fixture.skill");
    assert.equal(manifests.length, 1);
    const m = manifests[0]!;
    assert.equal(m.version, "1.0.0");
    assert.deepEqual(m.goalTypes, ["relationship.learning"]);
    assert.deepEqual(m.permissions, ["signal:write"]);
    assert.equal(m.riskBand, "advisory");
    assert.equal(m.budget?.maxCallsPerDay, 10);
    assert.deepEqual(m.defaultAgents, ["learning"]);
    assert.equal(m.childRunPolicy, "allowed");
  } finally {
    await close();
  }
});

test("skill manifest store: re-seeding the SAME catalog is idempotent (no duplicate rows)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const catalog = [fixtureManifest(organizationId)];
    await seedSkillManifests(db, catalog);
    await seedSkillManifests(db, catalog); // boot again with the same code-declared catalog

    const rows = await db.select().from(schema.skillManifests);
    assert.equal(rows.length, 1);
  } finally {
    await close();
  }
});

test("skill manifest store: multiple versions of one skill id are both retrievable via forSkill", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    await seedSkillManifests(db, [fixtureManifest(organizationId, { version: "1.0.0" }), fixtureManifest(organizationId, { version: "1.1.0" })]);

    const registry = new DrizzleSkillManifestRegistry(db);
    await registry.refresh();

    const manifests = registry.forSkill(organizationId, "test.fixture.skill");
    assert.equal(manifests.length, 2);
    assert.deepEqual(
      manifests.map((m) => m.version).sort(),
      ["1.0.0", "1.1.0"],
    );
  } finally {
    await close();
  }
});

test("skill manifest store: all() returns the full seeded catalog across skill ids", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    await seedSkillManifests(db, [fixtureManifest(organizationId, { skillId: "test.fixture.a" }), fixtureManifest(organizationId, { skillId: "test.fixture.b" })]);

    const registry = new DrizzleSkillManifestRegistry(db);
    await registry.refresh();

    assert.equal(registry.all(organizationId).length, 2);
  } finally {
    await close();
  }
});

test("skill manifest store: forSkill on an unregistered skill id returns empty, not an error", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const registry = new DrizzleSkillManifestRegistry(db);
    await registry.refresh();
    assert.deepEqual(registry.forSkill(organizationId, "nothing.registered"), []);
  } finally {
    await close();
  }
});

test("skill manifest store: reading forSkill/all before refresh() fails loud rather than silently returning empty", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = crypto.randomUUID();
    const registry = new DrizzleSkillManifestRegistry(db);
    assert.throws(() => registry.forSkill(organizationId, "test.fixture.skill"), /read before refresh/);
    assert.throws(() => registry.all(organizationId), /read before refresh/);
  } finally {
    await close();
  }
});

test("skill manifest registry never returns another organization's catalog", async () => {
  const { db, close } = await createLocalDb();
  try {
    const firstOrganization = await seedOrganization(db);
    const secondOrganization = await seedOrganization(db);
    await seedSkillManifests(db, [
      fixtureManifest(firstOrganization),
      fixtureManifest(secondOrganization),
    ]);
    const registry = new DrizzleSkillManifestRegistry(db);
    await registry.refresh();
    assert.equal(registry.forSkill(firstOrganization, "test.fixture.skill").length, 1);
    assert.equal(registry.forSkill(secondOrganization, "test.fixture.skill").length, 1);
    assert.equal(registry.all(firstOrganization).length, 1);
  } finally {
    await close();
  }
});
