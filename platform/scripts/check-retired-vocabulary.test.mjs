import assert from "node:assert/strict";
import test from "node:test";
import {
  compareInventories,
  familyMatchCount,
  inventoryForSource,
  isSourceFileName,
  shouldIgnore,
} from "./check-retired-vocabulary.mjs";

test("scanner covers private identifiers, interpolated templates, and JSX text", () => {
  const inventory = inventoryForSource(
    "apps/web/src/probe.tsx",
    `class Probe {
      #workflowState = "ready";
      render(id: string) {
        const label = \`new workflow \${id}\`;
        return <span>new workflow</span>;
      }
    }`,
  );
  assert.equal(inventory.workflow["apps/web/src/probe.tsx"].identifier, 1);
  assert.equal(inventory.workflow["apps/web/src/probe.tsx"].string, 2);
});

test("scanner counts retired tokens rather than only matching syntax nodes", () => {
  assert.equal(familyMatchCount("workflow workflow", { tokens: ["workflow"] }), 2);
  assert.equal(familyMatchCount("Second Brain", { tokens: ["brain", "brains"], allowPhrases: ["second brain"] }), 0);
  assert.equal(familyMatchCount("Second Brains", { tokens: ["brain", "brains"], allowPhrases: ["second brain"] }), 1);
  const inventory = inventoryForSource(
    "apps/web/src/probe.ts",
    `const workflowWorkflow = "workflow workflow";`,
  );
  assert.equal(inventory.workflow["apps/web/src/probe.ts"].identifier, 2);
  assert.equal(inventory.workflow["apps/web/src/probe.ts"].string, 2);
});

test("scanner folds static string, template, and JSX compositions", () => {
  const inventory = inventoryForSource(
    "apps/web/src/app/probe.tsx",
    `const binary = "work" + "flow";
     const template = \`work\${"flow"}\`;
     const jsx = <span>work{"flow"}</span>;`,
  );
  assert.equal(inventory.workflow["apps/web/src/app/probe.tsx"].string, 3);
});

test("scanner covers every retired Avatar phrase", () => {
  const inventory = inventoryForSource(
    "apps/web/src/app/probe.ts",
    `export const labels = ["Avatar Personality State", "14-Step Day-1 Onboarding"];`,
  );
  assert.equal(inventory.avatar_lifecycle["apps/web/src/app/probe.ts"].string, 2);
});

test("fingerprints reject one-for-one replacements and expose removals for baseline refresh", () => {
  const baseline = inventoryForSource(
    "packages/core/src/probe.ts",
    `const workflowState = "ready";`,
  );
  const unchanged = compareInventories(baseline, baseline);
  assert.deepEqual(unchanged, { introduced: [], removed: [] });

  const replacement = inventoryForSource(
    "packages/core/src/probe.ts",
    `const workflowQueue = "ready";`,
  );
  const changed = compareInventories(replacement, baseline);
  assert.equal(changed.introduced.length, 1);
  assert.equal(changed.removed.length, 1);

  const removed = compareInventories({}, baseline);
  assert.equal(removed.introduced.length, 0);
  assert.equal(removed.removed.length, 1);

  const literalBaseline = inventoryForSource(
    "packages/core/src/literal-probe.ts",
    `const label = "workflow";`,
  );
  const relocatedLiteral = inventoryForSource(
    "packages/core/src/literal-probe.ts",
    `function newApi() { return "workflow"; }`,
  );
  const relocated = compareInventories(relocatedLiteral, literalBaseline);
  assert.equal(relocated.introduced.length, 1);
  assert.equal(relocated.removed.length, 1);
});

test("only reviewed compatibility adapters are excluded", () => {
  assert.equal(shouldIgnore("apps/api/src/avatar-profile-v1-compat.ts"), true);
  assert.equal(shouldIgnore("apps/web/src/app/avatar/avatar-v1-compat.ts"), true);
  assert.equal(shouldIgnore("apps/api/src/unreviewed-compat.ts"), false);
  assert.equal(shouldIgnore("packages/core/src/compat/escape.ts"), false);
});

test("collector accepts TypeScript modules plus Rust and SQL sources", () => {
  for (const fileName of ["source.ts", "source.tsx", "source.mts", "source.cts", "source.rs", "source.sql"]) {
    assert.equal(isSourceFileName(fileName), true, fileName);
  }
});

test("Second Brain remains allowed without suppressing another brain token", () => {
  const allowed = inventoryForSource(
    "apps/web/src/app/allowed.ts",
    `export const label = "Second Brain";`,
  );
  assert.equal(allowed.brain, undefined);

  const blocked = inventoryForSource(
    "apps/web/src/app/blocked.ts",
    `export const label = "Second Brain must not become the runtime brain";`,
  );
  assert.equal(blocked.brain["apps/web/src/app/blocked.ts"].string, 1);

  const runtimeIdentifier = inventoryForSource(
    "packages/core/src/blocked.ts",
    `export const secondBrainEngine = "ready";`,
  );
  assert.equal(runtimeIdentifier.brain["packages/core/src/blocked.ts"].identifier, 1);
});

test("PostgreSQL jsonb array expansion is not classified as a product Element", () => {
  const sql = inventoryForSource(
    "packages/db/src/probe.sql",
    `SELECT * FROM jsonb_array_elements(payload);`,
  );
  assert.equal(sql.element, undefined);
});

test("Rust and SQL scanners cover identifiers and strings without counting comments", () => {
  const rust = inventoryForSource(
    "apps/desktop/src-tauri/src/probe.rs",
    `// workflow comments are not runtime contracts
     let workflow_state = r#"new workflow"#;`,
  );
  assert.equal(rust.workflow["apps/desktop/src-tauri/src/probe.rs"].identifier, 1);
  assert.equal(rust.workflow["apps/desktop/src-tauri/src/probe.rs"].string, 1);

  const sql = inventoryForSource(
    "packages/db/src/probe.sql",
    `-- workflow comments are not runtime contracts
     CREATE TABLE workflow_runs (label text DEFAULT 'new workflow');`,
  );
  assert.equal(sql.workflow["packages/db/src/probe.sql"].identifier, 1);
  assert.equal(sql.workflow["packages/db/src/probe.sql"].string, 1);
});
