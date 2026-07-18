/**
 * SEC-6 — workspace membership checks. A workspace-scoped procedure must refuse a
 * caller who is not a MEMBER of the workspace, not merely check the pilot-workspace
 * id. Exercises the membership surface (workspace.listMembers / workspace.inviteMember):
 * the seeded pilot member is allowed; a non-member is rejected with FORBIDDEN.
 */
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, type Actor, type RunCtx } from "@bridge/core";
import { UnknownWorkspaceError, type WorkspaceRow } from "@bridge/db";
import { appRouter } from "../src/router.js";
import { organizationFilesRoot } from "../src/module-files.js";
import {
  buildWiring,
  migrateLegacyPilotOrganization,
  PILOT_USER,
  PILOT_WORKSPACE,
  type Wiring,
} from "../src/wiring.js";

function makeRun(seed = 1): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring, identity: Actor) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity,
    authenticated: true,
    verifying: false,
  });
}

// A well-formed but unseeded user UUID: real auth identities are always UUIDs, so
// isMember() finds no membership row and returns false (rather than a malformed-id error).
const NON_MEMBER: Actor = { type: "user", id: "11111111-1111-4111-8111-111111111111" };

test("workspace.listMembers: the seeded pilot member is allowed and sees itself in the list", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const members = await caller.workspace.listMembers({ workspaceId: PILOT_WORKSPACE });
    assert.ok(
      members.some((m) => m.userId === PILOT_USER),
      "bootstrapPilotIdentities should seed the pilot user as a member of the pilot workspace",
    );
  } finally {
    await wiring.close();
  }
});

test("workspace.rename: a member updates the name and migrates the local Files root", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-workspace-rename-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousOrganizationRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  const evidencePath = join(previousOrganizationRoot, "Relationship", "evidence.txt");
  await mkdir(join(previousOrganizationRoot, "Relationship"), { recursive: true });
  await writeFile(evidencePath, "local evidence");
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const renamed = await caller.workspace.rename({
      workspaceId: PILOT_WORKSPACE,
      name: "  Product Leadership  ",
    });
    assert.equal(renamed.name, "Product Leadership");
    assert.equal((await caller.workspace.list()).find((row) => row.id === PILOT_WORKSPACE)?.name, "Product Leadership");
    assert.equal(
      await readFile(
        join(organizationFilesRoot("Product Leadership", bridgeRoot), "Relationship", "evidence.txt"),
        "utf8",
      ),
      "local evidence",
    );
    await assert.rejects(() => access(previousOrganizationRoot), { code: "ENOENT" });

    await assert.rejects(
      () => caller.workspace.rename({ workspaceId: PILOT_WORKSPACE, name: "." }),
      (err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST",
    );
    assert.equal((await caller.workspace.list()).find((row) => row.id === PILOT_WORKSPACE)?.name, "Product Leadership");
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workspace.rename: an existing target Files root blocks both filesystem and database rename", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-workspace-conflict-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousOrganizationRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  const targetOrganizationRoot = organizationFilesRoot("Existing Organization", bridgeRoot);
  await Promise.all([
    mkdir(previousOrganizationRoot, { recursive: true }),
    mkdir(targetOrganizationRoot, { recursive: true }),
  ]);
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    await assert.rejects(
      () => caller.workspace.rename({
        workspaceId: PILOT_WORKSPACE,
        name: "Existing Organization",
      }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );
    assert.equal((await caller.workspace.list()).find((row) => row.id === PILOT_WORKSPACE)?.name, "Pilot Organization");
    await Promise.all([access(previousOrganizationRoot), access(targetOrganizationRoot)]);
    await rm(previousOrganizationRoot, { recursive: true });
    await assert.rejects(
      () => caller.workspace.rename({
        workspaceId: PILOT_WORKSPACE,
        name: "Existing Organization",
      }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );
    assert.equal((await caller.workspace.list()).find((row) => row.id === PILOT_WORKSPACE)?.name, "Pilot Organization");
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workspace.rename: a symlinked source Files root is rejected without changing the database", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-workspace-symlink-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const outsideRoot = join(tempRoot, "outside");
  const previousOrganizationRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  await Promise.all([
    mkdir(bridgeRoot, { recursive: true }),
    mkdir(outsideRoot, { recursive: true }),
  ]);
  await symlink(outsideRoot, previousOrganizationRoot);
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    await assert.rejects(
      () => caller.workspace.rename({
        workspaceId: PILOT_WORKSPACE,
        name: "Product Leadership",
      }),
      (err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST",
    );
    assert.equal(
      (await caller.workspace.list()).find((row) => row.id === PILOT_WORKSPACE)?.name,
      "Pilot Organization",
    );
    await access(previousOrganizationRoot);
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workspace.rename: a persistence failure restores the original Files root", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-workspace-rollback-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousOrganizationRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  const targetOrganizationRoot = organizationFilesRoot("Product Leadership", bridgeRoot);
  await mkdir(previousOrganizationRoot, { recursive: true });
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  const originalLock = wiring.workspaceStore.withWorkspaceRenameLock.bind(wiring.workspaceStore);
  const failWith = (failure: unknown): typeof wiring.workspaceStore.withWorkspaceRenameLock =>
    async <T>(
      workspaceId: string,
      operation: (
        current: WorkspaceRow,
        persistName: (name: string) => Promise<WorkspaceRow>,
        registerRollback: (rollback: () => Promise<void>) => void,
      ) => Promise<T>,
    ): Promise<T> =>
      originalLock(
        workspaceId,
        (current, _persistName, registerRollback) =>
          operation(
            current,
            async () => {
              throw failure;
            },
            registerRollback,
          ),
      );
  wiring.workspaceStore.withWorkspaceRenameLock = failWith(new Error("test fixture persistence failure"));
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    await assert.rejects(
      () => caller.workspace.rename({
        workspaceId: PILOT_WORKSPACE,
        name: "Product Leadership",
      }),
      /test fixture persistence failure/,
    );
    await access(previousOrganizationRoot);
    await assert.rejects(() => access(targetOrganizationRoot), { code: "ENOENT" });
    wiring.workspaceStore.withWorkspaceRenameLock = failWith(new UnknownWorkspaceError(PILOT_WORKSPACE));
    await assert.rejects(
      () => caller.workspace.rename({
        workspaceId: PILOT_WORKSPACE,
        name: "Product Leadership",
      }),
      (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND",
    );
    await access(previousOrganizationRoot);
    await assert.rejects(() => access(targetOrganizationRoot), { code: "ENOENT" });
    wiring.workspaceStore.withWorkspaceRenameLock = originalLock;
    assert.equal((await caller.workspace.list()).find((row) => row.id === PILOT_WORKSPACE)?.name, "Pilot Organization");
  } finally {
    wiring.workspaceStore.withWorkspaceRenameLock = originalLock;
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workspace.rename: concurrent requests leave the database and local Files on one final name", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-workspace-concurrent-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  await mkdir(join(previousRoot, "Relationship"), { recursive: true });
  await writeFile(join(previousRoot, "Relationship", "evidence.txt"), "serialized");
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    await Promise.all([
      caller.workspace.rename({ workspaceId: PILOT_WORKSPACE, name: "First Organization" }),
      caller.workspace.rename({ workspaceId: PILOT_WORKSPACE, name: "Second Organization" }),
    ]);
    const finalName = (await caller.workspace.list()).find((row) => row.id === PILOT_WORKSPACE)?.name;
    assert.ok(finalName === "First Organization" || finalName === "Second Organization");
    assert.equal(
      await readFile(
        join(organizationFilesRoot(finalName, bridgeRoot), "Relationship", "evidence.txt"),
        "utf8",
      ),
      "serialized",
    );
    const otherName = finalName === "First Organization" ? "Second Organization" : "First Organization";
    await assert.rejects(() => access(organizationFilesRoot(otherName, bridgeRoot)), { code: "ENOENT" });
    await assert.rejects(() => access(previousRoot), { code: "ENOENT" });
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("legacy pilot bootstrap migrates its local Files root before updating the database name", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-workspace-legacy-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const legacyRoot = organizationFilesRoot("Pilot workspace", bridgeRoot);
  await mkdir(join(legacyRoot, "Relationship"), { recursive: true });
  await writeFile(join(legacyRoot, "Relationship", "evidence.txt"), "legacy");
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    await wiring.workspaceStore.renameWorkspace(PILOT_WORKSPACE, "Pilot workspace");
    await migrateLegacyPilotOrganization(wiring.workspaceStore, bridgeRoot);
    assert.equal(
      (await wiring.workspaceStore.listWorkspaces(PILOT_USER)).find((row) => row.id === PILOT_WORKSPACE)?.name,
      "Pilot Organization",
    );
    assert.equal(
      await readFile(
        join(organizationFilesRoot("Pilot Organization", bridgeRoot), "Relationship", "evidence.txt"),
        "utf8",
      ),
      "legacy",
    );
    await assert.rejects(() => access(legacyRoot), { code: "ENOENT" });
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workspace.rename: a non-member cannot rename the Organization", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, NON_MEMBER);
    await assert.rejects(
      () => caller.workspace.rename({ workspaceId: PILOT_WORKSPACE, name: "Intruder Organization" }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("workspace.listMembers: a non-member is refused with FORBIDDEN", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, NON_MEMBER);
    await assert.rejects(
      () => caller.workspace.listMembers({ workspaceId: PILOT_WORKSPACE }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("workspace.inviteMember: a non-member cannot invite into a workspace they don't belong to", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, NON_MEMBER);
    await assert.rejects(
      () =>
        caller.workspace.inviteMember({
          workspaceId: PILOT_WORKSPACE,
          email: "test_fixture_intruder@example.com",
        }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});
