import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("migration journal timestamps are ordered and never future-dated", () => {
  const journal = JSON.parse(
    readFileSync(resolve(here, "../../migrations/meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; when: number; tag: string }> };
  for (let index = 0; index < journal.entries.length; index += 1) {
    const entry = journal.entries[index]!;
    assert.ok(entry.when <= Date.now(), `${entry.tag} must not be future-dated`);
    if (index > 0) {
      assert.ok(entry.when > journal.entries[index - 1]!.when, `${entry.tag} must be ordered after its predecessor`);
    }
  }
});

test("TASK-007 orchestration migration is after the released 0013 high-water mark", () => {
  const journal = JSON.parse(
    readFileSync(resolve(here, "../../migrations/meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; when: number; tag: string }> };
  const released = journal.entries.find((entry) => entry.tag === "0013_uneven_dragon_lord");
  const orchestration = journal.entries.find(
    (entry) => entry.tag === "0014_task007_goal_task_skill_manifest_child_run",
  );

  assert.ok(released, "released 0013 migration must remain in the journal");
  assert.ok(orchestration, "TASK-007 orchestration migration must remain in the journal");
  assert.ok(
    orchestration.when > released.when,
    "TASK-007 must apply to databases already migrated through released 0013",
  );
});

test("TASK-008 Relation migration is ordered after TASK-007", () => {
  const journal = JSON.parse(
    readFileSync(resolve(here, "../../migrations/meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; when: number; tag: string }> };
  const orchestration = journal.entries.find(
    (entry) => entry.tag === "0014_task007_goal_task_skill_manifest_child_run",
  );
  const relations = journal.entries.find(
    (entry) => entry.tag === "0015_task008_relation_contract",
  );

  assert.ok(orchestration, "TASK-007 migration must remain in the journal");
  assert.ok(relations, "TASK-008 Relation migration must remain in the journal");
  assert.equal(relations.idx, 15);
  assert.ok(
    relations.when > orchestration.when,
    "TASK-008 Relation migration must apply after TASK-007",
  );
});

test("TASK-012 migrations remain ordered through final compatibility deletion", () => {
  const journal = JSON.parse(
    readFileSync(resolve(here, "../../migrations/meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };
  assert.deepEqual(
    journal.entries.slice(-5).map(({ idx, tag }) => ({ idx, tag })),
    [
      { idx: 20, tag: "0020_vocab2_automation_engine" },
      { idx: 21, tag: "0021_vocab3_organization_module_record" },
      { idx: 22, tag: "0022_supabase_runtime_role" },
      { idx: 23, tag: "0023_vocab4_event_result_file" },
      { idx: 24, tag: "0024_task012_compatibility_deletion" },
    ],
  );
});
