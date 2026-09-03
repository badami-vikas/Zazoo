/**
 * The source-toggle + deadline persistence, against a real pglite-backed
 * Postgres. This is the layer the unit tests in @bridge/jobpilot cannot reach:
 * the toggle upsert, the deadline column and its window query, the repeat-sweep
 * unique constraint, and the last-run bookkeeping that tells a dead board apart
 * from an irrelevant one.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createLocalDb, DrizzleJobPilotStore, schema } from "../src/index.js";

async function fixture() {
  const { db, client, close } = await createLocalDb();
  const [ws] = await db
    .insert(schema.organizations)
    .values({ name: "test_fixture_ws_jobpilot_sources" })
    .returning({ id: schema.organizations.id });
  assert.ok(ws);
  return { db, client, close, orgId: ws.id, store: new DrizzleJobPilotStore(db) };
}

test("source toggles default to absent, then upsert on/off", async () => {
  const { close, orgId, store } = await fixture();
  try {
    // A source the user has never touched has NO row — the router reads that as
    // off. Defaulting to on would fire thousands of unrequested HTTP calls.
    assert.deepEqual(await store.listSourceStates(orgId), []);

    await store.setSourceEnabled(orgId, "gh-stripe", true);
    let states = await store.listSourceStates(orgId);
    assert.equal(states.length, 1);
    assert.equal(states[0]?.enabled, true);

    // Toggling again must UPDATE, not insert a second row.
    await store.setSourceEnabled(orgId, "gh-stripe", false);
    states = await store.listSourceStates(orgId);
    assert.equal(states.length, 1);
    assert.equal(states[0]?.enabled, false);
  } finally {
    await close();
  }
});

test("recordSourceRun stores fetched and kept separately", async () => {
  const { close, orgId, store } = await fixture();
  try {
    // 860 found / 0 kept is a healthy board that is irrelevant to this
    // candidate. An error is a dead slug. One number could not tell them apart.
    await store.recordSourceRun(orgId, "gh-databricks", { fetched: 860, kept: 0 });
    await store.recordSourceRun(orgId, "gh-gone", { fetched: 0, kept: 0, error: 'greenhouse board "gone" failed (404)' });

    const states = await store.listSourceStates(orgId);
    const healthy = states.find((s) => s.sourceId === "gh-databricks");
    const dead = states.find((s) => s.sourceId === "gh-gone");
    assert.equal(healthy?.lastFetched, 860);
    assert.equal(healthy?.lastKept, 0);
    assert.equal(healthy?.lastError, null);
    assert.match(String(dead?.lastError), /404/);
    assert.ok(healthy?.lastCheckedAt instanceof Date);
  } finally {
    await close();
  }
});

test("deadline persists and the window query filters, orders, and excludes nulls", async () => {
  const { close, orgId, store } = await fixture();
  try {
    await store.createJob({ organizationId: orgId, title: "Late Sept", company: "C", url: "u1", deadline: "2026-09-30" });
    await store.createJob({ organizationId: orgId, title: "Early Sept", company: "B", url: "u2", deadline: "2026-09-11" });
    await store.createJob({ organizationId: orgId, title: "October", company: "D", url: "u3", deadline: "2026-10-15" });
    await store.createJob({ organizationId: orgId, title: "No deadline", company: "A", url: "u4" });

    const september = await store.listJobs(orgId, {
      limit: 50,
      offset: 0,
      deadlineFrom: "2026-09-01",
      deadlineTo: "2026-09-30",
    });
    // Soonest first, October excluded, and the undated row excluded — asking
    // "what closes in September" is asking for dated rows only.
    assert.deepEqual(september.items.map((j) => j.title), ["Early Sept", "Late Sept"]);
    // `total` counts the WINDOW, not the org — which is what makes the router's
    // `hasMore` correct when paginating a filtered result.
    assert.equal(september.total, 2);

    // Unwindowed listing still returns everything, newest-created first.
    const all = await store.listJobs(orgId, { limit: 50, offset: 0 });
    assert.equal(all.items.length, 4);
  } finally {
    await close();
  }
});

test("the same posting url cannot be stored twice — the repeat-sweep guard", async () => {
  const { close, orgId, store } = await fixture();
  try {
    await store.createJob({ organizationId: orgId, title: "Ops Manager", company: "Acme", url: "https://x/1" });
    await assert.rejects(
      () => store.createJob({ organizationId: orgId, title: "Ops Manager", company: "Acme", url: "https://x/1" }),
      (err: unknown) => {
        // drizzle wraps the driver error, so the constraint name lives on the
        // cause chain rather than the top-level message.
        const chain = `${String((err as Error).message)} ${String(((err as Error).cause as Error | undefined)?.message ?? "")}`;
        assert.match(chain, /jobpilot_jobs_org_url_uq/);
        return true;
      },
    );

    // Rows with no url are unaffected — Postgres treats NULLs as distinct, so
    // manually-added jobs can still be created freely.
    await store.createJob({ organizationId: orgId, title: "Manual A", company: "Acme" });
    await store.createJob({ organizationId: orgId, title: "Manual B", company: "Acme" });

    const urls = await store.existingJobUrls(orgId);
    assert.deepEqual([...urls], ["https://x/1"]);
  } finally {
    await close();
  }
});

test("migration 0045 survives a database that already holds duplicate urls", async () => {
  // CLAUDE.md: "a fresh database is not a test — migration bugs hide behind
  // fresh installs." A bare ALTER ... ADD CONSTRAINT UNIQUE fails with "could
  // not create unique index" on any machine that already has two jobs sharing a
  // url, and no fresh-install run can ever surface that. This reproduces the
  // pre-0045 state and replays the migration's OWN sql, so the test fails if
  // someone later removes the de-duplication step from the file.
  const { client, close, orgId } = await fixture();
  try {
    await client.query('ALTER TABLE jobpilot_jobs DROP CONSTRAINT jobpilot_jobs_org_url_uq');
    const ids: string[] = [];
    for (const title of ["Job A", "Job B", "Job C"]) {
      const inserted = await client.query<{ id: string }>(
        'INSERT INTO jobpilot_jobs (organization_id, title, company, url) VALUES ($1,$2,$3,$4) RETURNING id',
        [orgId, title, "Acme", "https://x/1"],
      );
      const id = inserted.rows[0]!.id;
      ids.push(id);
      await client.query(
        "INSERT INTO jobpilot_applications (organization_id, job_id, stage) VALUES ($1,$2,'submitted')",
        [orgId, id],
      );
    }

    // Resolved the same way src/client-local.ts does it: this file runs from
    // `test/` under tsc-src layouts and `dist/test/` after a build.
    const migration = ["../migrations", "../../migrations"]
      .map((rel) => new URL(`${rel}/0045_jobpilot_sources.sql`, import.meta.url))
      .find((candidate) => existsSync(candidate));
    assert.ok(migration, "0045 must be locatable from the test's runtime layout");
    const sql = readFileSync(migration, "utf8");
    const statements = sql.split("--> statement-breakpoint");
    const dedupe = statements.find((part) => part.includes('SET "url" = NULL'));
    assert.ok(dedupe, "0045 must de-duplicate BEFORE adding the constraint");
    await client.query(dedupe);
    await client.query(statements.at(-1)!);

    // Non-destructive: every row and every tracked application survives; only
    // the later duplicates' urls are released, and NULLs are exempt.
    const jobs = await client.query<{ title: string; url: string | null }>(
      "SELECT title, url FROM jobpilot_jobs WHERE organization_id = $1 ORDER BY title",
      [orgId],
    );
    assert.equal(jobs.rows.length, 3, "no row may be deleted to satisfy a clutter guard");
    assert.equal(jobs.rows.filter((r) => r.url !== null).length, 1, "exactly one keeps the url");
    const apps = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM jobpilot_applications WHERE organization_id = $1",
      [orgId],
    );
    assert.equal(apps.rows[0]?.n, 3, "tracked applications must not be lost");
  } finally {
    await close();
  }
});
