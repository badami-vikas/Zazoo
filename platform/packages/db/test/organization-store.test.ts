/**
 * Organization + team-member CRUD, against a real (pglite) database: create a
 * organization (creator becomes a member), see it appear in the creator's list,
 * invite a new member by email (find-or-create user), see them appear in the
 * member list. Plain CRUD, no pipeline/ledger involvement.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "drizzle-orm";
import {
  createLocalDb,
  DrizzleOrganizationStore,
  schema,
  type OrganizationRenameCoordinator,
} from "../src/index.js";

function renameCoordinator() {
  const observed: Array<{ previous: string; next: string }> = [];
  let recoveryCount = 0;
  const coordinator: OrganizationRenameCoordinator = {
    createLease: async () => ({
      recover: async () => {
        recoveryCount += 1;
      },
      rename: async (previous, next) => {
        observed.push({ previous, next });
      },
      complete: async () => {},
    }),
  };
  return {
    coordinator,
    observed,
    recoveryCount: () => recoveryCount,
  };
}

test("create organization -> appears in creator's list -> invite -> appears in members list", async () => {
  const { db, close } = await createLocalDb();
  try {
    // Seed the creator user (FK target for organization_members.user_id).
    const [creator] = await db.insert(schema.users).values({ email: "test_fixture_creator@example.com" }).returning({
      id: schema.users.id,
    });

    assert.ok(creator, "creator user seeded");

    const unconfiguredStore = new DrizzleOrganizationStore(db);

    const ws = await unconfiguredStore.createOrganization("test_fixture_organization", creator.id);
    assert.equal(ws.name, "test_fixture_organization");
    assert.ok(ws.id);
    assert.ok(ws.createdAt);

    // Creator sees the new organization in their list.
    const creatorOrganizations = await unconfiguredStore.listOrganizations(creator.id);
    assert.deepEqual(
      creatorOrganizations.map((w) => w.id),
      [ws.id],
    );

    await assert.rejects(
      () => unconfiguredStore.renameOrganization(ws.id, "Uncoordinated"),
      /rename coordinator is not configured/,
    );
    const { coordinator } = renameCoordinator();
    const store = new DrizzleOrganizationStore(db, coordinator);
    const renamed = await store.renameOrganization(ws.id, "Product Leadership");
    assert.equal(renamed.name, "Product Leadership");
    assert.equal((await store.listOrganizations(creator.id))[0]?.name, "Product Leadership");
    await assert.rejects(
      () => store.renameOrganization("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Unknown"),
      /organization: unknown id/,
    );

    // A different user has no organizations yet.
    const [otherUser] = await db.insert(schema.users).values({ email: "test_fixture_other@example.com" }).returning({
      id: schema.users.id,
    });
    assert.deepEqual(await store.listOrganizations(otherUser!.id), []);

    // Creator is already a member (from creation).
    const membersBeforeInvite = await store.listMembers(ws.id);
    assert.deepEqual(
      membersBeforeInvite.map((m) => m.email),
      ["test_fixture_creator@example.com"],
    );

    // Invite a brand-new email — find-or-create the user, then add as a member.
    const invited = await store.inviteMember(ws.id, "test_fixture_invitee@example.com");
    assert.equal(invited.email, "test_fixture_invitee@example.com");
    assert.ok(invited.userId);

    const membersAfterInvite = await store.listMembers(ws.id);
    assert.deepEqual(
      membersAfterInvite.map((m) => m.email).sort(),
      ["test_fixture_creator@example.com", "test_fixture_invitee@example.com"].sort(),
    );

    // Inviting an EXISTING user (e.g. otherUser's email) reuses their user row and
    // does not duplicate membership if invited twice.
    const reInvited = await store.inviteMember(ws.id, "test_fixture_other@example.com");
    assert.equal(reInvited.userId, otherUser!.id);
    const invitedTwice = await store.inviteMember(ws.id, "test_fixture_other@example.com");
    assert.equal(invitedTwice.userId, otherUser!.id);
    const membersAfterReinvite = await store.listMembers(ws.id);
    // No duplicate row for otherUser despite inviting twice.
    assert.equal(membersAfterReinvite.filter((m) => m.userId === otherUser!.id).length, 1);
  } finally {
    await close();
  }
});

test("pilot identity bootstrap preserves existing names for the Files-aware API migration", async () => {
  const { db, close } = await createLocalDb();
  try {
    const store = new DrizzleOrganizationStore(db);
    const legacyOrganizationId = randomUUID();
    const legacyUserId = randomUUID();
    const customOrganizationId = randomUUID();
    const customUserId = randomUUID();
    await db.insert(schema.organizations).values([
      { id: legacyOrganizationId, name: "Pilot organization" },
      { id: customOrganizationId, name: "Custom Organization" },
    ]);

    await store.bootstrapPilotIdentities({
      organizationId: legacyOrganizationId,
      userId: legacyUserId,
      userEmail: "test_fixture_legacy_pilot@example.com",
    });
    await store.bootstrapPilotIdentities({
      organizationId: customOrganizationId,
      userId: customUserId,
      userEmail: "test_fixture_custom_pilot@example.com",
    });

    const [migratedOrganization] = await store.listOrganizations(legacyUserId);
    const [customOrganization] = await store.listOrganizations(customUserId);
    assert.equal(migratedOrganization?.name, "Pilot organization");
    assert.equal(customOrganization?.name, "Custom Organization");
  } finally {
    await close();
  }
});

test("organization rename row lock serializes current-name reads and recovers external state", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [creator] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_rename_lock@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(creator);
    const rename = renameCoordinator();
    const store = new DrizzleOrganizationStore(db, rename.coordinator);
    const organization = await store.createOrganization("Before", creator.id);
    await Promise.all([
      store.renameOrganization(organization.id, "First"),
      store.renameOrganization(organization.id, "Second"),
    ]);
    assert.equal(rename.observed.length, 2);
    assert.equal(rename.observed.filter(({ previous }) => previous === "Before").length, 1);
    assert.ok(rename.observed.some(({ previous }) => previous === "First" || previous === "Second"));
    const currentName = (await store.listOrganizations(creator.id))[0]?.name ?? "";
    assert.ok(["First", "Second"].includes(currentName));

    await db.execute(sql`
      ALTER TABLE organizations
      ADD CONSTRAINT organization_rename_test_reject
      CHECK (name <> 'Rejected')
    `);
    const recoveriesBeforeFailure = rename.recoveryCount();
    await assert.rejects(
      () => store.renameOrganization(organization.id, "Rejected"),
      /Failed query: update "organizations"/,
    );
    assert.equal(rename.recoveryCount(), recoveriesBeforeFailure + 2);
    assert.equal((await store.listOrganizations(creator.id))[0]?.name, currentName);
  } finally {
    await close();
  }
});
