/**
 * Workspace + team-member CRUD, against a real (pglite) database: create a
 * workspace (creator becomes a member), see it appear in the creator's list,
 * invite a new member by email (find-or-create user), see them appear in the
 * member list. Plain CRUD, no pipeline/ledger involvement.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleWorkspaceStore, schema } from "../src/index.js";

test("create workspace -> appears in creator's list -> invite -> appears in members list", async () => {
  const { db, close } = await createLocalDb();
  try {
    // Seed the creator user (FK target for workspace_members.user_id).
    const [creator] = await db.insert(schema.users).values({ email: "dummy_creator@example.com" }).returning({
      id: schema.users.id,
    });
    assert.ok(creator, "creator user seeded");

    const store = new DrizzleWorkspaceStore(db);

    const ws = await store.createWorkspace("dummy_workspace", creator.id);
    assert.equal(ws.name, "dummy_workspace");
    assert.ok(ws.id);
    assert.ok(ws.createdAt);

    // Creator sees the new workspace in their list.
    const creatorWorkspaces = await store.listWorkspaces(creator.id);
    assert.deepEqual(
      creatorWorkspaces.map((w) => w.id),
      [ws.id],
    );

    // A different user has no workspaces yet.
    const [otherUser] = await db.insert(schema.users).values({ email: "dummy_other@example.com" }).returning({
      id: schema.users.id,
    });
    assert.deepEqual(await store.listWorkspaces(otherUser!.id), []);

    // Creator is already a member (from creation).
    const membersBeforeInvite = await store.listMembers(ws.id);
    assert.deepEqual(
      membersBeforeInvite.map((m) => m.email),
      ["dummy_creator@example.com"],
    );

    // Invite a brand-new email — find-or-create the user, then add as a member.
    const invited = await store.inviteMember(ws.id, "dummy_invitee@example.com");
    assert.equal(invited.email, "dummy_invitee@example.com");
    assert.ok(invited.userId);

    const membersAfterInvite = await store.listMembers(ws.id);
    assert.deepEqual(
      membersAfterInvite.map((m) => m.email).sort(),
      ["dummy_creator@example.com", "dummy_invitee@example.com"].sort(),
    );

    // Inviting an EXISTING user (e.g. otherUser's email) reuses their user row and
    // does not duplicate membership if invited twice.
    const reInvited = await store.inviteMember(ws.id, "dummy_other@example.com");
    assert.equal(reInvited.userId, otherUser!.id);
    const invitedTwice = await store.inviteMember(ws.id, "dummy_other@example.com");
    assert.equal(invitedTwice.userId, otherUser!.id);
    const membersAfterReinvite = await store.listMembers(ws.id);
    // No duplicate row for otherUser despite inviting twice.
    assert.equal(membersAfterReinvite.filter((m) => m.userId === otherUser!.id).length, 1);
  } finally {
    await close();
  }
});
