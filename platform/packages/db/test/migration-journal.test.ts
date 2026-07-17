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
