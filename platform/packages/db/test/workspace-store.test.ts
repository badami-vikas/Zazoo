/**
 * Workspace + team-member CRUD, against a real (pglite) database: create a
 * workspace (creator becomes a member), see it appear in the creator's list,
 * invite a new member by email (find-or-create user), see them appear in the
 * member list. Plain CRUD, no pipeline/ledger involvement.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createLocalDb, DrizzleWorkspaceStore, schema } from "../src/index.js";

test("create workspace -> appears in creator's list -> invite -> appears in members list", async () => {
  const { db, close } = await createLocalDb();
  try {
    // Seed the creator user (FK target for workspace_members.user_id).
    const [creator] = await db.insert(schema.users).values({ email: "test_fixture_creator@example.com" }).returning({
      id: schema.users.id,
    });

    assert.ok(creator, "creator user seeded");

    const store = new DrizzleWorkspaceStore(db);

    const ws = await store.createWorkspace("test_fixture_workspace", creator.id);
    assert.equal(ws.name, "test_fixture_workspace");
    assert.ok(ws.id);
    assert.ok(ws.createdAt);

    // Creator sees the new workspace in their list.
    const creatorWorkspaces = await store.listWorkspaces(creator.id);
    assert.deepEqual(
      creatorWorkspaces.map((w) => w.id),
      [ws.id],
    );

    const renamed = await store.renameWorkspace(ws.id, "Product Leadership");
    assert.equal(renamed.name, "Product Leadership");
    assert.equal((await store.listWorkspaces(creator.id))[0]?.name, "Product Leadership");
    await assert.rejects(
      () => store.renameWorkspace("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Unknown"),
      /workspace: unknown id/,
    );

    // A different user has no workspaces yet.
    const [otherUser] = await db.insert(schema.users).values({ email: "test_fixture_other@example.com" }).returning({
      id: schema.users.id,
    });
    assert.deepEqual(await store.listWorkspaces(otherUser!.id), []);

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
    const store = new DrizzleWorkspaceStore(db);
    const legacyWorkspaceId = randomUUID();
    const legacyUserId = randomUUID();
    const customWorkspaceId = randomUUID();
    const customUserId = randomUUID();
    await db.insert(schema.workspaces).values([
      { id: legacyWorkspaceId, name: "Pilot workspace" },
      { id: customWorkspaceId, name: "Custom Organization" },
    ]);

    await store.bootstrapPilotIdentities({
      workspaceId: legacyWorkspaceId,
      userId: legacyUserId,
      userEmail: "test_fixture_legacy_pilot@example.com",
    });
    await store.bootstrapPilotIdentities({
      workspaceId: customWorkspaceId,
      userId: customUserId,
      userEmail: "test_fixture_custom_pilot@example.com",
    });

    const [migratedOrganization] = await store.listWorkspaces(legacyUserId);
    const [customOrganization] = await store.listWorkspaces(customUserId);
    assert.equal(migratedOrganization?.name, "Pilot workspace");
    assert.equal(customOrganization?.name, "Custom Organization");
  } finally {
    await close();
  }
});

test("workspace rename lock serializes current-name reads and rolls back registered external state", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [creator] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_rename_lock@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(creator);
    const store = new DrizzleWorkspaceStore(db);
    const workspace = await store.createWorkspace("Before", creator.id);
    const observed: string[] = [];
    await Promise.all([
      store.withWorkspaceRenameLock(workspace.id, async (current, persistName) => {
        observed.push(current.name);
        await persistName("First");
      }),
      store.withWorkspaceRenameLock(workspace.id, async (current, persistName) => {
        observed.push(current.name);
        await persistName("Second");
      }),
    ]);
    assert.equal(observed.length, 2);
    assert.equal(observed.filter((name) => name === "Before").length, 1);
    assert.ok(observed.some((name) => name === "First" || name === "Second"));
    assert.ok(["First", "Second"].includes((await store.listWorkspaces(creator.id))[0]?.name ?? ""));

    let rolledBack = false;
    await assert.rejects(
      () =>
        store.withWorkspaceRenameLock(workspace.id, async (_current, _persistName, registerRollback) => {
          registerRollback(async () => {
            rolledBack = true;
          });
          throw new Error("test fixture rename failure");
        }),
      /test fixture rename failure/,
    );
    assert.equal(rolledBack, true);
  } finally {
    await close();
  }
});
