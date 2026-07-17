/**
 * DrizzleJobPilotStore against a real pglite-backed Postgres. Proves the
 * workspace-scoped JobPilot persistence: createJob also opens its tracking
 * application (stage "queued"), listJobs left-joins the application + counts,
 * updateApplication patches stage/flag/fitScore (and clears a flag), and
 * getApplication is tenant-scoped. State-machine validity lives in
 * @bridge/jobpilot; the store only persists already-validated transitions.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createLocalDb, DrizzleJobPilotStore, schema } from "../src/index.js";

const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";

test("jobpilot: createJob + listJobs + updateApplication + getApplication", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_ws_jobpilot" })
      .returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleJobPilotStore(db);

    const { job, application } = await store.createJob({
      workspaceId: ws.id,
      title: "Staff Engineer",
      company: "Acme",
      location: "Remote",
      salaryMax: 250000,
      url: "https://jobs.example.com/1",
      source: "lever",
    });
    assert.equal(job.title, "Staff Engineer");
    assert.equal(job.company, "Acme");
    assert.equal(job.location, "Remote");
    assert.equal(job.salaryMax, 250000);
    assert.equal(application.jobId, job.id);
    assert.equal(application.stage, "queued");

    // Minimal job (optional fields omitted).
    await store.createJob({ workspaceId: ws.id, title: "IC5 Backend", company: "Beta" });

    const page = await store.listJobs(ws.id, { limit: 10, offset: 0 });
    assert.equal(page.total, 2);
    assert.equal(page.items.length, 2);
    const withApp = page.items.find((j) => j.id === job.id);
    assert.ok(withApp?.application);
    assert.equal(withApp?.application?.id, application.id);

    // Patch stage + flag + fitScore. `flag: "green"` is a legacy (pre-AP-023)
    // value — TASK-010 review round-4 item 11: the store normalizes it to
    // "pursue" on EVERY read boundary (not merely a test-only helper), so a
    // not-yet-backfilled row never round-trips its old value to a caller.
    const updated = await store.updateApplication(application.id, { stage: "applied", flag: "green", fitScore: 0.82 });
    assert.ok(updated);
    assert.equal(updated?.stage, "applied");
    assert.equal(updated?.flag, "pursue", "a legacy 'green' value must be normalized to 'pursue' at the store's own read boundary");
    assert.equal(Number(updated?.fitScore), 0.82);

    // flag: null is a distinct "clear it" branch (!== undefined).
    const cleared = await store.updateApplication(application.id, { flag: null });
    assert.equal(cleared?.flag, null);

    // getApplication: found (tenant-scoped) + not found.
    const got = await store.getApplication(application.id, ws.id);
    assert.equal(got?.id, application.id);
    assert.equal(await store.getApplication(MISSING_ID, ws.id), null);

    // updateApplication on an unknown row → null.
    assert.equal(await store.updateApplication(MISSING_ID, { stage: "screen" }), null);
  } finally {
    await close();
  }
});

test("jobpilot review round-4 item 11: legacy green/yellow/red flags are normalized at EVERY read boundary (listJobs, getApplication, createJob), not only updateApplication", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_jobpilot_legacy_flag" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleJobPilotStore(db);

    const { job, application } = await store.createJob({ workspaceId: ws.id, title: "Legacy Flag Role", company: "Acme" });
    // Write a raw legacy value directly (bypassing updateApplication's own
    // normalization return) to simulate a row persisted BEFORE the AP-023
    // rename and never backfilled — the pending-migration scenario item 11
    // exists for.
    await db.update(schema.jobpilotApplications).set({ flag: "yellow" }).where(eq(schema.jobpilotApplications.id, application.id));

    const viaGet = await store.getApplication(application.id, ws.id);
    assert.equal(viaGet?.flag, "review", "getApplication must normalize a legacy value read directly from the DB");

    const page = await store.listJobs(ws.id, { limit: 10, offset: 0 });
    const viaList = page.items.find((j) => j.id === job.id);
    assert.equal(viaList?.application?.flag, "review", "listJobs must normalize a legacy value on its own projection");

    // A freshly-created application (no flag set yet) must not be corrupted
    // by the normalizer — null stays null, never coerced to some default.
    const { application: fresh } = await store.createJob({ workspaceId: ws.id, title: "Fresh Role", company: "Acme" });
    assert.equal(fresh.flag, null);

    // A modern value must pass through unchanged (not double-mapped).
    const modern = await store.updateApplication(application.id, { flag: "pass" });
    assert.equal(modern?.flag, "pass");
  } finally {
    await close();
  }
});
