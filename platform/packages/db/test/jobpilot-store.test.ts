/**
 * DrizzleJobPilotStore against a real pglite-backed Postgres. Proves the
 * organization-scoped JobPilot persistence: createJob also opens its tracking
 * application (stage "queued"), listJobs left-joins the application + counts,
 * updateApplication patches stage/flag/fitScore (and clears a flag), and
 * getApplication is tenant-scoped. State-machine validity lives in
 * @bridge/jobpilot; the store only persists already-validated transitions.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleJobPilotStore, schema } from "../src/index.js";

const MISSING_ID = "00000000-0000-4000-8000-0000000000ff";

test("jobpilot: createJob + listJobs + updateApplication + getApplication", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.organizations)
      .values({ name: "test_fixture_ws_jobpilot" })
      .returning({ id: schema.organizations.id });
    assert.ok(ws);
    const store = new DrizzleJobPilotStore(db);

    const { job, application } = await store.createJob({
      organizationId: ws.id,
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
    await store.createJob({ organizationId: ws.id, title: "IC5 Backend", company: "Beta" });

    const page = await store.listJobs(ws.id, { limit: 10, offset: 0 });
    assert.equal(page.total, 2);
    assert.equal(page.items.length, 2);
    const withApp = page.items.find((j) => j.id === job.id);
    assert.ok(withApp?.application);
    assert.equal(withApp?.application?.id, application.id);

    // Patch stage + flag + fitScore. TASK-010 review round-6: `jobpilot_applications.flag`
    // now has a real CHECK constraint (migration 0016) enforcing only
    // pursue/review/pass can ever be written — the legacy green/yellow/red
    // read-boundary-normalization scenario (round-4 item 11) is exercised
    // against the migration's own backfill in migration-0016.test.ts instead,
    // since a fresh write of a legacy value is now structurally impossible.
    const updated = await store.updateApplication(application.id, { stage: "applied", flag: "pursue", fitScore: 0.82 });
    assert.ok(updated);
    assert.equal(updated?.stage, "applied");
    assert.equal(updated?.flag, "pursue");
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

// Round-4 item 11's "legacy green/yellow/red flags are normalized at every
// read boundary" scenario is now exercised against migration 0016's own
// backfill in migration-0016.test.ts — a fresh write of a legacy value is
// structurally impossible here since that migration's CHECK constraint
// landed (a legacy value can only ever exist on a row that predates it).
