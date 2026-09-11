import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb } from "../src/index.js";

test("migration 0045 creates the infra lease + rate-limit tables without tenant RLS", async () => {
  const { client, close } = await createLocalDb();
  try {
    const tables = await client.query<{ relname: string; relpersistence: string; rls: boolean }>(`
      SELECT relname, relpersistence, relrowsecurity AS rls
      FROM pg_class
      WHERE relname IN ('job_leases', 'rate_limit_buckets')
      ORDER BY relname
    `);
    // Infra tables: no organization column, so no RLS; the counter is UNLOGGED ('u').
    assert.deepEqual(tables.rows, [
      { relname: "job_leases", relpersistence: "p", rls: false },
      { relname: "rate_limit_buckets", relpersistence: "u", rls: false },
    ]);
    const columns = await client.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_name IN ('job_leases', 'rate_limit_buckets')
      ORDER BY table_name, ordinal_position
    `);
    assert.deepEqual(
      columns.rows.map((r) => `${r.table_name}.${r.column_name}`),
      [
        "job_leases.name",
        "job_leases.holder",
        "job_leases.expires_at",
        "rate_limit_buckets.key",
        "rate_limit_buckets.count",
        "rate_limit_buckets.reset_at",
      ],
    );
  } finally {
    await close();
  }
});
