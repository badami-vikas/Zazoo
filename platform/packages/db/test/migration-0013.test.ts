import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));

function migrationSql(): string {
  for (const relative of [
    "../migrations/0013_uneven_dragon_lord.sql",
    "../../migrations/0013_uneven_dragon_lord.sql",
  ]) {
    const candidate = resolve(here, relative);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  throw new Error("0013 migration not found");
}

async function legacyDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE "skills" (
      "id" uuid PRIMARY KEY,
      "workspace_id" uuid,
      "name" text NOT NULL
    );
    CREATE TABLE "agents" (
      "id" uuid PRIMARY KEY,
      "workspace_id" uuid NOT NULL,
      "allowed_skills" uuid[] DEFAULT '{}' NOT NULL
    );
    CREATE TABLE "rituals" (
      "id" uuid PRIMARY KEY,
      "workspace_id" uuid NOT NULL,
      "agent_ids" uuid[] DEFAULT '{}' NOT NULL,
      "skill_pipeline" jsonb DEFAULT '[]' NOT NULL
    );
  `);
  return db;
}

test("migration 0013 translates Skill UUID allowlists and preserves fail-closed Ritual ownership", async () => {
  const db = await legacyDatabase();
  try {
    const workspaceId = "10000000-0000-4000-8000-000000000001";
    const firstSkillId = "20000000-0000-4000-8000-000000000001";
    const secondSkillId = "20000000-0000-4000-8000-000000000002";
    const firstAgentId = "30000000-0000-4000-8000-000000000001";
    const secondAgentId = "30000000-0000-4000-8000-000000000002";
    const crossWorkspaceAgentId = "30000000-0000-4000-8000-000000000003";
    const otherWorkspaceId = "10000000-0000-4000-8000-000000000002";
    await db.query(
      `INSERT INTO "skills" ("id", "workspace_id", "name") VALUES
        ($1, NULL, 'test_fixture_global_skill'),
        ($2, $3, 'test_fixture_workspace_skill')`,
      [firstSkillId, secondSkillId, workspaceId],
    );
    await db.query(
      `INSERT INTO "agents" ("id", "workspace_id", "allowed_skills") VALUES
        ($1, $4, ARRAY[$5, $6]::uuid[]),
        ($2, $4, ARRAY[]::uuid[]),
        ($3, $7, ARRAY[]::uuid[])`,
      [
        firstAgentId,
        secondAgentId,
        crossWorkspaceAgentId,
        workspaceId,
        secondSkillId,
        firstSkillId,
        otherWorkspaceId,
      ],
    );
    await db.query(
      `INSERT INTO "rituals" ("id", "workspace_id", "agent_ids", "skill_pipeline") VALUES
        ('40000000-0000-4000-8000-000000000001', $4, ARRAY[$1]::uuid[], '[{"skill":"test_fixture_local","action":"write","resourceType":"touchpoint"}]'),
        ('40000000-0000-4000-8000-000000000002', $4, ARRAY[$1]::uuid[], '[{"skill":"test_fixture_fetch","action":"read","resourceType":"external:fetch"}]'),
        ('40000000-0000-4000-8000-000000000003', $4, ARRAY[$1, $2]::uuid[], '[{"skill":"test_fixture_local","action":"write","resourceType":"touchpoint"}]'),
        ('40000000-0000-4000-8000-000000000004', $4, ARRAY[$3]::uuid[], '[{"skill":"test_fixture_local","action":"write","resourceType":"touchpoint"}]'),
        ('40000000-0000-4000-8000-000000000005', $4, ARRAY[$1]::uuid[], '[{"skill":"test_fixture_malformed","action":"read"}]'),
        ('40000000-0000-4000-8000-000000000006', $4, ARRAY[$1]::uuid[], '[{"skill":"test_fixture_share","action":"share","resourceType":"person"}]')`,
      [firstAgentId, secondAgentId, crossWorkspaceAgentId, workspaceId],
    );

    await db.exec(migrationSql());

    const agents = await db.query<{ id: string; allowed_skills: string[] }>(
      `SELECT "id", "allowed_skills" FROM "agents" ORDER BY "id"`,
    );
    assert.deepEqual(agents.rows, [
      {
        id: firstAgentId,
        allowed_skills: ["test_fixture_workspace_skill", "test_fixture_global_skill"],
      },
      { id: secondAgentId, allowed_skills: [] },
      { id: crossWorkspaceAgentId, allowed_skills: [] },
    ]);

    const rituals = await db.query<{ id: string; agent_id: string | null; agent_plane: string | null }>(
      `SELECT "id", "agent_id", "agent_plane" FROM "rituals" ORDER BY "id"`,
    );
    assert.deepEqual(rituals.rows, [
      {
        id: "40000000-0000-4000-8000-000000000001",
        agent_id: firstAgentId,
        agent_plane: "local",
      },
      {
        id: "40000000-0000-4000-8000-000000000002",
        agent_id: null,
        agent_plane: null,
      },
      {
        id: "40000000-0000-4000-8000-000000000003",
        agent_id: null,
        agent_plane: null,
      },
      {
        id: "40000000-0000-4000-8000-000000000004",
        agent_id: null,
        agent_plane: null,
      },
      {
        id: "40000000-0000-4000-8000-000000000005",
        agent_id: null,
        agent_plane: null,
      },
      {
        id: "40000000-0000-4000-8000-000000000006",
        agent_id: null,
        agent_plane: null,
      },
    ]);
  } finally {
    await db.close();
  }
});

test("migration 0013 aborts rather than widening an unresolved Skill allowlist", async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(`
      INSERT INTO "agents" ("id", "workspace_id", "allowed_skills")
      VALUES (
        '30000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        ARRAY['20000000-0000-4000-8000-000000000099']::uuid[]
      );
    `);
    await assert.rejects(
      () => db.exec(migrationSql()),
      /unresolved or cross-workspace Skill reference/,
    );
  } finally {
    await db.close();
  }
});
