import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb } from "../src/index.js";

test("four concurrent migrated PGlite databases initialize, respond, and close cleanly", async () => {
  for (let wave = 0; wave < 2; wave += 1) {
    const databases = await Promise.all(
      Array.from({ length: 4 }, () => createLocalDb()),
    );
    try {
      const results = await Promise.all(
        databases.map(({ client }) =>
          client.query<{ count: string }>(`
            SELECT count(*)::text AS count
            FROM drizzle.__drizzle_migrations
          `),
        ),
      );
      assert.ok(results.every(({ rows }) => Number(rows[0]?.count ?? 0) > 0));
    } finally {
      await Promise.all(databases.map(({ close }) => close()));
    }
  }
});
