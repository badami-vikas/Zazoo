/**
 * Academics (TASK-069) in the form ADR 2026-09-04 "The Egg ships the kernel;
 * Modules live in Commons" requires: a Commons manifest with three declared
 * Databases and no code of its own. A bare Egg registers it, the install is
 * approved, and the standard Module Page's `moduleRecords.*` serves each
 * Page's rows from the Local Plane.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireBuiltInModule } from "@bridge/module-manifests";
import { InMemorySourceCredentialVault } from "@bridge/dealpilot";

import { buildWiring, PILOT_ORGANIZATION } from "../src/wiring.js";
import { makeCaller } from "./caller.js";
import { approveInstall } from "./module-records.test.js";

test("an Egg installs Academics from its Commons manifest and serves Subjects, Lecture Sessions, and Assignments Records", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-academics-"));
  const wiring = await buildWiring({
    profile: "egg",
    localDir: join(root, "local"),
    moduleFilesBridgeRoot: join(root, "files"),
    dealPilotCredentialVault: new InMemorySourceCredentialVault(),
  });
  try {
    const caller = makeCaller(wiring);
    const before = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    assert.equal(
      before.items.some((item) => item.moduleName === "academics" && item.status === "installed"),
      false,
      "the Egg does not seed Academics",
    );

    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: { module: requireBuiltInModule("academics").manifest },
    });
    await approveInstall(caller, installation.id);

    const target = (databaseId: string) => ({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "academics",
      databaseId,
    });

    const subjects = await caller.moduleRecords.definition(target("subjects"));
    assert.deepEqual(
      subjects.spec.columns.map((column) => column.id),
      ["name", "code", "term", "instructor", "credits"],
    );
    for (const databaseId of ["subjects", "lecture-sessions", "assignments"]) {
      assert.deepEqual(await caller.moduleRecords.list(target(databaseId)), { items: [], total: 0, hasMore: false });
    }

    const subject = await caller.moduleRecords.insert({
      ...target("subjects"),
      fields: { name: "Linear Algebra", code: "MATH 221", term: "Fall 2026", credits: 4 },
    });
    const session = await caller.moduleRecords.insert({
      ...target("lecture-sessions"),
      fields: { subject: subject.id, date: "2026-09-08", topic: "Vector spaces" },
    });
    const assignment = await caller.moduleRecords.insert({
      ...target("assignments"),
      fields: { subject: subject.id, title: "Problem set 1", due_date: "2026-09-15", status: "not_started" },
    });

    assert.deepEqual(
      (await caller.moduleRecords.list(target("subjects"))).items.map((row) => row.id),
      [subject.id],
    );
    const sessions = await caller.moduleRecords.list(target("lecture-sessions"));
    assert.deepEqual(sessions.items.map((row) => [row.id, row.subject]), [[session.id, subject.id]]);
    const assignments = await caller.moduleRecords.list(target("assignments"));
    assert.deepEqual(assignments.items.map((row) => [row.id, row.status]), [[assignment.id, "not_started"]]);

    await assert.rejects(
      caller.moduleRecords.insert({ ...target("assignments"), fields: { title: "x", grader: "me" } }),
      /grader is not a column/,
    );
  } finally {
    await wiring.close();
    await rm(root, { recursive: true, force: true });
  }
});
