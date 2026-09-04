/**
 * SEC-6 — organization membership checks. A organization-scoped procedure must refuse a
 * caller who is not a MEMBER of the organization, not merely check the pilot-organization
 * id. Exercises the membership surface (organization.listMembers / organization.inviteMember):
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
import { OrganizationRenameRollbackError } from "@bridge/db";
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
  PILOT_ORGANIZATION,
  type Wiring,
} from "../src/wiring.js";
import { makeCaller } from "./caller.js";

// A well-formed but unseeded user UUID: real auth identities are always UUIDs, so
// isMember() finds no membership row and returns false (rather than a malformed-id error).
const NON_MEMBER: Actor = { type: "user", id: "11111111-1111-4111-8111-111111111111" };

test("organization.listMembers: the seeded pilot member is allowed and sees itself in the list", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const members = await caller.organization.listMembers({ organizationId: PILOT_ORGANIZATION });
    assert.ok(
      members.some((m) => m.userId === PILOT_USER),
      "bootstrapPilotIdentities should seed the pilot user as a member of the pilot organization",
    );
  } finally {
    await wiring.close();
  }
});

test("organization.rename: a member updates the name and migrates the local Files root", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-organization-rename-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousOrganizationRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  const evidencePath = join(previousOrganizationRoot, "Relationship", "evidence.txt");
  await mkdir(join(previousOrganizationRoot, "Relationship"), { recursive: true });
  await writeFile(evidencePath, "local evidence");
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const renamed = await caller.organization.rename({
      organizationId: PILOT_ORGANIZATION,
      name: "  Product Leadership  ",
    });
    assert.equal(renamed.name, "Product Leadership");
    assert.equal((await caller.organization.list()).find((row) => row.id === PILOT_ORGANIZATION)?.name, "Product Leadership");
    assert.equal(
      await readFile(
        join(organizationFilesRoot("Product Leadership", bridgeRoot), "Relationship", "evidence.txt"),
        "utf8",
      ),
      "local evidence",
    );
    await assert.rejects(() => access(previousOrganizationRoot), { code: "ENOENT" });

    await assert.rejects(
      () => caller.organization.rename({ organizationId: PILOT_ORGANIZATION, name: "." }),
      (err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST",
    );
    assert.equal((await caller.organization.list()).find((row) => row.id === PILOT_ORGANIZATION)?.name, "Product Leadership");
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("organization Files lock keeps an upload attached during a concurrent Organization rename", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-organization-upload-race-"));
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
    const upload = wiring.organizationStore.withLockedOrganizationFiles(
      PILOT_ORGANIZATION,
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
    const rename = caller.organization.rename({
      organizationId: PILOT_ORGANIZATION,
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

test("organization.rename: case-only names keep database and Files entry casing aligned", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-organization-case-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousName = "Pilot Organization";
  const nextName = "PILOT ORGANIZATION";
  const previousRoot = organizationFilesRoot(previousName, bridgeRoot);
  await mkdir(join(previousRoot, "Relationship"), { recursive: true });
  await writeFile(join(previousRoot, "Relationship", "evidence.txt"), "case");
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const interrupted = await createOrganizationRenameLease(PILOT_ORGANIZATION, bridgeRoot);
    await interrupted.rename(previousName, nextName);
    await interrupted.recover(previousName);
    assert.ok((await readdir(bridgeRoot)).includes(previousName));

    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const renamed = await caller.organization.rename({
      organizationId: PILOT_ORGANIZATION,
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

test("organization.rename: an existing target Files root blocks both filesystem and database rename", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-organization-conflict-"));
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
      () => caller.organization.rename({
        organizationId: PILOT_ORGANIZATION,
        name: "Existing Organization",
      }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );
    assert.equal((await caller.organization.list()).find((row) => row.id === PILOT_ORGANIZATION)?.name, "Pilot Organization");
    await Promise.all([access(previousOrganizationRoot), access(targetOrganizationRoot)]);
    const interruptedIntentPath = join(
      bridgeRoot,
      ".locks",
      `organization-${PILOT_ORGANIZATION}.intent.json`,
    );
    await writeFile(
      interruptedIntentPath,
      JSON.stringify({
        organizationId: PILOT_ORGANIZATION,
        generation: "preflight-conflict-generation",
        previousOrganizationName: "Pilot Organization",
        nextOrganizationName: "Existing Organization",
        createdAt: new Date().toISOString(),
      }),
    );
    await assert.rejects(
      () => migrateLegacyPilotOrganization(wiring.organizationStore),
      (error: unknown) =>
        error instanceof OrganizationRenameRollbackError
        && [error.renameError, error.rollbackError].every(
          (cause) =>
            cause instanceof Error
            && cause.message.includes("Both Organization Files roots exist"),
        ),
    );
    await access(interruptedIntentPath);
    await Promise.all([access(previousOrganizationRoot), access(targetOrganizationRoot)]);
    await rm(targetOrganizationRoot, { recursive: true });
    const recovered = await caller.organization.rename({
      organizationId: PILOT_ORGANIZATION,
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

test("organization.rename: a symlinked source Files root is rejected without changing the database", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-organization-symlink-"));
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
      () => caller.organization.rename({
        organizationId: PILOT_ORGANIZATION,
        name: "Product Leadership",
      }),
      (err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST",
    );
    assert.equal(
      (await caller.organization.list()).find((row) => row.id === PILOT_ORGANIZATION)?.name,
      "Pilot Organization",
    );
    await access(previousOrganizationRoot);
    await assert.rejects(
      () => caller.modules.files({ organizationId: PILOT_ORGANIZATION, moduleName: "relationship" }),
      (err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST",
    );
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("organization.rename: a retry repairs a Files move interrupted before database commit", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-organization-recover-old-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousOrganizationRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  const targetOrganizationRoot = organizationFilesRoot("Product Leadership", bridgeRoot);
  const evidencePath = join(previousOrganizationRoot, "Relationship", "evidence.txt");
  await mkdir(join(previousOrganizationRoot, "Relationship"), { recursive: true });
  await writeFile(evidencePath, "local evidence");
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const lease = await createOrganizationRenameLease(PILOT_ORGANIZATION, bridgeRoot);
    await lease.recover("Pilot Organization");
    await lease.rename("Pilot Organization", "Product Leadership");
    // Deliberately omit lease.complete(): this is the persistent state left by a
    // process that exits after moving Files but before committing the DB name.
    await assert.rejects(() => access(previousOrganizationRoot), { code: "ENOENT" });
    await access(targetOrganizationRoot);

    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const renamed = await caller.organization.rename({
      organizationId: PILOT_ORGANIZATION,
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
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-organization-recover-new-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousOrganizationRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  const targetOrganizationRoot = organizationFilesRoot("Product Leadership", bridgeRoot);
  await mkdir(previousOrganizationRoot, { recursive: true });
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    await caller.organization.rename({
      organizationId: PILOT_ORGANIZATION,
      name: "Product Leadership",
    });
    await writeFile(
      join(
        bridgeRoot,
        ".locks",
        `organization-${PILOT_ORGANIZATION}.intent.json`,
      ),
      JSON.stringify({
        organizationId: PILOT_ORGANIZATION,
        generation: "interrupted-generation",
        previousOrganizationName: "Pilot Organization",
        nextOrganizationName: "Product Leadership",
        createdAt: new Date().toISOString(),
      }),
    );
    // Deliberately omit lease.complete(): the DB commit succeeded, but the
    // process exited before it could remove the durable intent.

    await migrateLegacyPilotOrganization(wiring.organizationStore);
    assert.equal(
      (await wiring.organizationStore.listOrganizations(PILOT_USER))
        .find((organization) => organization.id === PILOT_ORGANIZATION)?.name,
      "Product Leadership",
    );
    await access(targetOrganizationRoot);
    await assert.rejects(() => access(previousOrganizationRoot), { code: "ENOENT" });
    await assert.rejects(
      () => access(join(
        bridgeRoot,
        ".locks",
        `organization-${PILOT_ORGANIZATION}.intent.json`,
      )),
      { code: "ENOENT" },
    );
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("stale completion cannot delete a newer Organization rename intent", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-organization-intent-generation-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const originalRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  const firstRoot = organizationFilesRoot("First Organization", bridgeRoot);
  const secondRoot = organizationFilesRoot("Second Organization", bridgeRoot);
  await mkdir(join(originalRoot, "Relationship"), { recursive: true });
  await writeFile(join(originalRoot, "Relationship", "evidence.txt"), "generation");
  try {
    const firstLease = await createOrganizationRenameLease(PILOT_ORGANIZATION, bridgeRoot);
    await firstLease.rename("Pilot Organization", "First Organization");

    const secondLease = await createOrganizationRenameLease(PILOT_ORGANIZATION, bridgeRoot);
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

test("organization.rename: concurrent requests leave the database and local Files on one final name", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-organization-concurrent-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const previousRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
  await mkdir(join(previousRoot, "Relationship"), { recursive: true });
  await writeFile(join(previousRoot, "Relationship", "evidence.txt"), "serialized");
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    await Promise.all([
      caller.organization.rename({ organizationId: PILOT_ORGANIZATION, name: "First Organization" }),
      caller.organization.rename({ organizationId: PILOT_ORGANIZATION, name: "Second Organization" }),
    ]);
    const finalName = (await caller.organization.list()).find((row) => row.id === PILOT_ORGANIZATION)?.name;
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
  const tempRoot = await mkdtemp(join(tmpdir(), "bridge-organization-legacy-"));
  const bridgeRoot = join(tempRoot, "Bridge");
  const legacyRoot = organizationFilesRoot("Pilot organization", bridgeRoot);
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const currentRoot = organizationFilesRoot("Pilot Organization", bridgeRoot);
    await mkdir(join(currentRoot, "Relationship"), { recursive: true });
    await writeFile(join(currentRoot, "Relationship", "evidence.txt"), "legacy");
    await wiring.organizationStore.renameOrganization(
      PILOT_ORGANIZATION,
      "Pilot organization",
    );
    await access(join(legacyRoot, "Relationship", "evidence.txt"));
    await migrateLegacyPilotOrganization(wiring.organizationStore);
    assert.equal(
      (await wiring.organizationStore.listOrganizations(PILOT_USER)).find((row) => row.id === PILOT_ORGANIZATION)?.name,
      "Pilot Organization",
    );
    assert.equal(
      await readFile(
        join(organizationFilesRoot("Pilot Organization", bridgeRoot), "Relationship", "evidence.txt"),
        "utf8",
      ),
      "legacy",
    );
    const organizationRoots = await readdir(bridgeRoot);
    assert.ok(organizationRoots.includes("Pilot Organization"));
    assert.equal(organizationRoots.includes("Pilot organization"), false);
  } finally {
    await wiring.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("organization.rename: a non-member cannot rename the Organization", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, NON_MEMBER);
    await assert.rejects(
      () => caller.organization.rename({ organizationId: PILOT_ORGANIZATION, name: "Intruder Organization" }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("organization.listMembers: a non-member is refused with FORBIDDEN", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, NON_MEMBER);
    await assert.rejects(
      () => caller.organization.listMembers({ organizationId: PILOT_ORGANIZATION }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("organization.inviteMember: a non-member cannot invite into a organization they don't belong to", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, NON_MEMBER);
    await assert.rejects(
      () =>
        caller.organization.inviteMember({
          organizationId: PILOT_ORGANIZATION,
          email: "test_fixture_intruder@example.com",
        }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});
