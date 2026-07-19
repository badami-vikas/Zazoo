/**
 * SEC-6 — workspace membership checks. A workspace-scoped procedure must refuse a
 * caller who is not a MEMBER of the workspace, not merely check the pilot-workspace
 * id. Exercises the membership surface (workspace.listMembers / workspace.inviteMember):
 * the seeded pilot member is allowed; a non-member is rejected with FORBIDDEN.
 */
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkspaceRenameRollbackError } from "@bridge/db";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, type Actor, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import {
  createOrganizationRenameLease,
  organizationFilesRoot,
  saveModuleFile,
} from "../src/module-files.js";
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

test("workspace Files lock keeps an upload attached during a concurrent Organization rename", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-workspace-upload-race-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  let releaseUpload!: () => void;
  let uploadLocked!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    uploadLocked = resolve;
  });
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const upload = wiring.workspaceStore.withLockedWorkspaceFiles(
      PILOT_WORKSPACE,
      async (organization) => {
        uploadLocked();
        await release;
        return saveModuleFile(
          organization.name,
          "Relationship",
          "evidence.txt",
          Buffer.from("private local evidence"),
          bridgeRoot,
        );
      },
    );
    await locked;

    let renameSettled = false;
    const rename = caller.workspace.rename({
      workspaceId: PILOT_WORKSPACE,
      name: "Product Leadership",
    }).finally(() => {
      renameSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(renameSettled, false);

    releaseUpload();
    await Promise.all([upload, rename]);
    const nextRoot = organizationFilesRoot("Product Leadership", bridgeRoot);
    assert.equal(
      await readFile(join(nextRoot, "Relationship", "evidence.txt"), "utf8"),
      "private local evidence",
    );
    await assert.rejects(
      () => access(organizationFilesRoot("Pilot Organization", bridgeRoot)),
      { code: "ENOENT" },
    );
  } finally {
    releaseUpload();
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workspace.rename: case-only names keep database and Files entry casing aligned", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-workspace-case-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousName = "Pilot Organization";
  const nextName = "PILOT ORGANIZATION";
  const previousRoot = organizationFilesRoot(previousName, bridgeRoot);
  await mkdir(join(previousRoot, "Relationship"), { recursive: true });
  await writeFile(join(previousRoot, "Relationship", "evidence.txt"), "case");
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const interrupted = await createOrganizationRenameLease(PILOT_WORKSPACE, bridgeRoot);
    await interrupted.rename(previousName, nextName);
    await interrupted.recover(previousName);
    assert.ok((await readdir(bridgeRoot)).includes(previousName));

    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const renamed = await caller.workspace.rename({
      workspaceId: PILOT_WORKSPACE,
      name: nextName,
    });
    assert.equal(renamed.name, nextName);
    const entries = await readdir(bridgeRoot);
    assert.ok(entries.includes(nextName));
    assert.equal(entries.includes(previousName), false);
    assert.equal(
      await readFile(
        join(organizationFilesRoot(nextName, bridgeRoot), "Relationship", "evidence.txt"),
        "utf8",
      ),
      "case",
    );
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
    const interruptedIntentPath = join(
      bridgeRoot,
      ".locks",
      `organization-${PILOT_WORKSPACE}.intent.json`,
    );
    await writeFile(
      interruptedIntentPath,
      JSON.stringify({
        workspaceId: PILOT_WORKSPACE,
        generation: "preflight-conflict-generation",
        previousOrganizationName: "Pilot Organization",
        nextOrganizationName: "Existing Organization",
        createdAt: new Date().toISOString(),
      }),
    );
    await assert.rejects(
      () => migrateLegacyPilotOrganization(wiring.workspaceStore),
      (error: unknown) =>
        error instanceof WorkspaceRenameRollbackError
        && [error.renameError, error.rollbackError].every(
          (cause) =>
            cause instanceof Error
            && cause.message.includes("Both Organization Files roots exist"),
        ),
    );
    await access(interruptedIntentPath);
    await Promise.all([access(previousOrganizationRoot), access(targetOrganizationRoot)]);
    await rm(targetOrganizationRoot, { recursive: true });
    const recovered = await caller.workspace.rename({
      workspaceId: PILOT_WORKSPACE,
      name: "Existing Organization",
    });
    assert.equal(recovered.name, "Existing Organization");
    await assert.rejects(() => access(interruptedIntentPath), { code: "ENOENT" });
    await access(targetOrganizationRoot);
    await assert.rejects(() => access(previousOrganizationRoot), { code: "ENOENT" });
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
    mkdir(join(outsideRoot, "Relationship"), { recursive: true }),
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
    await assert.rejects(
      () => caller.packages.files({ workspaceId: PILOT_WORKSPACE, moduleName: "relationship" }),
      (err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST",
    );
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workspace.rename: a retry repairs a Files move interrupted before database commit", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-workspace-recover-old-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousOrganizationRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  const targetOrganizationRoot = organizationFilesRoot("Product Leadership", bridgeRoot);
  const evidencePath = join(previousOrganizationRoot, "Relationship", "evidence.txt");
  await mkdir(join(previousOrganizationRoot, "Relationship"), { recursive: true });
  await writeFile(evidencePath, "local evidence");
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const lease = await createOrganizationRenameLease(PILOT_WORKSPACE, bridgeRoot);
    await lease.recover("Pilot Organization");
    await lease.rename("Pilot Organization", "Product Leadership");
    // Deliberately omit lease.complete(): this is the persistent state left by a
    // process that exits after moving Files but before committing the DB name.
    await assert.rejects(() => access(previousOrganizationRoot), { code: "ENOENT" });
    await access(targetOrganizationRoot);

    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const renamed = await caller.workspace.rename({
      workspaceId: PILOT_WORKSPACE,
      name: "Product Leadership",
    });
    assert.equal(renamed.name, "Product Leadership");
    assert.equal(
      await readFile(join(targetOrganizationRoot, "Relationship", "evidence.txt"), "utf8"),
      "local evidence",
    );
    await assert.rejects(() => access(previousOrganizationRoot), { code: "ENOENT" });
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("legacy bootstrap clears an interrupted intent after the database commit", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-workspace-recover-new-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousOrganizationRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  const targetOrganizationRoot = organizationFilesRoot("Product Leadership", bridgeRoot);
  await mkdir(previousOrganizationRoot, { recursive: true });
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    await caller.workspace.rename({
      workspaceId: PILOT_WORKSPACE,
      name: "Product Leadership",
    });
    await writeFile(
      join(
        bridgeRoot,
        ".locks",
        `organization-${PILOT_WORKSPACE}.intent.json`,
      ),
      JSON.stringify({
        workspaceId: PILOT_WORKSPACE,
        generation: "interrupted-generation",
        previousOrganizationName: "Pilot Organization",
        nextOrganizationName: "Product Leadership",
        createdAt: new Date().toISOString(),
      }),
    );
    // Deliberately omit lease.complete(): the DB commit succeeded, but the
    // process exited before it could remove the durable intent.

    await migrateLegacyPilotOrganization(wiring.workspaceStore);
    assert.equal(
      (await wiring.workspaceStore.listWorkspaces(PILOT_USER))
        .find((workspace) => workspace.id === PILOT_WORKSPACE)?.name,
      "Product Leadership",
    );
    await access(targetOrganizationRoot);
    await assert.rejects(() => access(previousOrganizationRoot), { code: "ENOENT" });
    await assert.rejects(
      () => access(join(
        bridgeRoot,
        ".locks",
        `organization-${PILOT_WORKSPACE}.intent.json`,
      )),
      { code: "ENOENT" },
    );
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("stale completion cannot delete a newer Organization rename intent", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-workspace-intent-generation-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const originalRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  const firstRoot = organizationFilesRoot("First Organization", bridgeRoot);
  const secondRoot = organizationFilesRoot("Second Organization", bridgeRoot);
  await mkdir(join(originalRoot, "Relationship"), { recursive: true });
  await writeFile(join(originalRoot, "Relationship", "evidence.txt"), "generation");
  try {
    const firstLease = await createOrganizationRenameLease(PILOT_WORKSPACE, bridgeRoot);
    await firstLease.rename("Pilot Organization", "First Organization");

    const secondLease = await createOrganizationRenameLease(PILOT_WORKSPACE, bridgeRoot);
    await secondLease.recover("First Organization");
    await secondLease.rename("First Organization", "Second Organization");
    await firstLease.complete();

    await secondLease.recover("First Organization");
    assert.equal(
      await readFile(join(firstRoot, "Relationship", "evidence.txt"), "utf8"),
      "generation",
    );
    await assert.rejects(() => access(originalRoot), { code: "ENOENT" });
    await assert.rejects(() => access(secondRoot), { code: "ENOENT" });
  } finally {
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
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const currentRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
    await mkdir(join(currentRoot, "Relationship"), { recursive: true });
    await writeFile(join(currentRoot, "Relationship", "evidence.txt"), "legacy");
    await wiring.workspaceStore.renameWorkspace(
      PILOT_WORKSPACE,
      "Pilot workspace",
    );
    await access(join(legacyRoot, "Relationship", "evidence.txt"));
    await migrateLegacyPilotOrganization(wiring.workspaceStore);
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
