import assert from "node:assert/strict";
import test from "node:test";
import {
  compareInventories,
  compareInventoryTotals,
  familyMatchCount,
  inventoryForSource,
  isSourceFileName,
  shouldIgnore,
  applyAllowlist,
  assertAllowlist,
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

test("a family count growing above its baseline is reported as a regression", () => {
  const baseline = inventoryForSource("packages/core/src/probe.ts", `const workflowState = "ready";`);
  const grown = inventoryForSource(
    "packages/core/src/probe.ts",
    `const workflowState = "ready"; const workflowQueue = "workflow";`,
  );
  assert.ok(compareInventories(grown, baseline).introduced.length > 0);
  assert.equal(compareInventories(grown, baseline).removed.length, 0);
  assert.deepEqual(
    compareInventoryTotals(grown, baseline).increases.map((i) => [i.family, i.kind, i.baselineCount, i.currentCount]),
    [["workflow", "identifier", 1, 2], ["workflow", "string", 0, 1]],
  );
});

test("reviewed fingerprint moves remain downward-only by family and syntax kind", () => {
  const baseline = inventoryForSource(
    "packages/core/src/old-path.ts",
    `const workflowState = "workflow";`,
  );
  const moved = inventoryForSource(
    "packages/core/src/new-path.ts",
    `const workflowState = "workflow";`,
  );
  assert.equal(compareInventories(moved, baseline).introduced.length, 2);
  assert.deepEqual(compareInventoryTotals(moved, baseline).increases, []);

  const grown = inventoryForSource(
    "packages/core/src/new-path.ts",
    `const workflowWorkflowState = "workflow workflow";`,
  );
  assert.equal(compareInventoryTotals(grown, baseline).increases.length, 2);
});

test("only explicit migration and signed-content boundaries are excluded", () => {
  assert.equal(shouldIgnore("packages/db/src/media-schema-migrations.ts"), true);
  assert.equal(shouldIgnore("packages/db/test/migration-0024.test.ts"), true);
  assert.equal(shouldIgnore("packages/core/src/module/signed-legacy-entry.ts"), true);
  assert.equal(shouldIgnore("services/commons/src/legacy-registry-migration.ts"), true);
  assert.equal(shouldIgnore("apps/web/dist-oldplatform/assets/zazoo-CiVa0QeL.js"), true);
  assert.equal(shouldIgnore("apps/web/dist/assets/index.js"), true);
  assert.equal(shouldIgnore("apps/web/src/distance.ts"), false);
  assert.equal(shouldIgnore("apps/api/src/unreviewed-compat.ts"), false);
  assert.equal(shouldIgnore("packages/core/src/compat/escape.ts"), false);
  assert.equal(shouldIgnore("apps/api/test/router.test.ts"), false);
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

test("technical DOM and projection identifiers stay classified without allowing product nouns", () => {
  const dom = inventoryForSource(
    "apps/web/src/app/routes.tsx",
    `const node: HTMLDivElement = document.createElement("div");
     export const route = { element: node };`,
  );
  assert.equal(dom.element, undefined);

  const projection = inventoryForSource(
    "packages/core/src/run-context.ts",
    `export function projectToPrompt() { return "ready"; }`,
  );
  assert.equal(projection.project, undefined);

  const parallelMcpMethod = inventoryForSource(
    "packages/models/src/parallel-search-provider.ts",
    `export const method = "tools/call";`,
  );
  assert.equal(parallelMcpMethod.tool, undefined);

  const appleKeyPartition = inventoryForSource(
    "apps/desktop/scripts/import-macos-certificate.mjs",
    `const partition = "apple-tool:,apple:,codesign:";`,
  );
  assert.equal(appleKeyPartition.tool, undefined);

  const preVocabularyAdapter = inventoryForSource(
    "packages/db/src/client-local.ts",
    `export const previousTenantColumn = "workspace_id";`,
  );
  assert.equal(preVocabularyAdapter.workspace, undefined);

  const preVocabularyFixture = inventoryForSource(
    "packages/db/test/local-store.test.ts",
    `await client.query("INSERT INTO workspaces (id, name) VALUES ($1, $2)");`,
  );
  assert.equal(preVocabularyFixture.workspace, undefined);

  const forbidden = inventoryForSource(
    "packages/core/src/record.ts",
    `export interface ProjectElement { label: string }`,
  );
  assert.equal(forbidden.project["packages/core/src/record.ts"].identifier, 1);
  assert.equal(forbidden.element["packages/core/src/record.ts"].identifier, 1);
});

test("the npm manifest filename is allowed only at the reviewed desktop bundle seam", () => {
  const allowed = inventoryForSource(
    "apps/desktop/scripts/prepare-bundle.mjs",
    `const manifest = join(root, "package.json");`,
  );
  assert.equal(allowed.package, undefined);

  const blocked = inventoryForSource(
    "apps/web/src/app/blocked.ts",
    `export const label = "package.json";`,
  );
  assert.equal(blocked.package["apps/web/src/app/blocked.ts"].string, 1);
});

test("Rust and SQL scanners cover identifiers and strings without counting comments", () => {
  const rust = inventoryForSource(
    "apps/desktop/src-tauri/src/probe.rs",
    `// workflow comments are not runtime contracts
     let workflow_state = r#"new workflow"#;`,
  );
  assert.equal(rust.workflow["apps/desktop/src-tauri/src/probe.rs"].identifier, 1);
  assert.equal(rust.workflow["apps/desktop/src-tauri/src/probe.rs"].string, 1);

  const appKit = inventoryForSource(
    "apps/desktop/src-tauri/src/providers/apps.rs",
    `use objc2_app_kit::NSWorkspace;
     let app_manager = NSWorkspace::sharedWorkspace();`,
  );
  assert.equal(appKit.workspace, undefined);

  const sql = inventoryForSource(
    "packages/db/src/probe.sql",
    `-- workflow comments are not runtime contracts
     CREATE TABLE workflow_runs (label text DEFAULT 'new workflow');`,
  );
  assert.equal(sql.workflow["packages/db/src/probe.sql"].identifier, 1);
  assert.equal(sql.workflow["packages/db/src/probe.sql"].string, 1);
});

test("allowlist drops only the exempted family under the exempted path prefix", () => {
  const inventory = {
    tool: {
      "packages/research/src/chat-planner.ts": { identifier: { abc: 1 } },
      "commons/whatsapp/src/tools.ts": { identifier: { def: 1 } },
    },
    element: { "packages/research/src/http-reader.ts": { identifier: { ghi: 1 } } },
  };
  const filtered = applyAllowlist(inventory, [
    { family: "tool", pathPrefix: "packages/research/", reason: "x".repeat(40), reviewed: "AP-096" },
  ]);
  // The exempt file is gone; the SAME family elsewhere is untouched, so an
  // exemption can never quietly cover Bridge-owned vocabulary in another module.
  assert.deepEqual(Object.keys(filtered.tool), ["commons/whatsapp/src/tools.ts"]);
  // A different family under the same prefix is untouched too.
  assert.ok(filtered.element["packages/research/src/http-reader.ts"]);
});

test("a family emptied by the allowlist disappears rather than lingering as an empty entry", () => {
  const filtered = applyAllowlist(
    { tool: { "packages/research/src/engine.ts": { identifier: { abc: 1 } } } },
    [{ family: "tool", pathPrefix: "packages/research/", reason: "x".repeat(40), reviewed: "AP-096" }],
  );
  assert.deepEqual(filtered, {});
});

test("an allowlist entry without a real reason is refused — an unexplained exemption is a silenced regression", () => {
  const entry = { family: "tool", pathPrefix: "packages/research/", reviewed: "AP-096" };
  assert.throws(() => assertAllowlist({ version: 1, entries: [entry] }), /missing "reason"/);
  assert.throws(
    () => assertAllowlist({ version: 1, entries: [{ ...entry, reason: "legacy" }] }),
    /needs a real reason/,
  );
  for (const field of ["family", "pathPrefix", "reviewed"]) {
    const partial = { family: "tool", pathPrefix: "p/", reason: "x".repeat(40), reviewed: "AP-096" };
    delete partial[field];
    assert.throws(() => assertAllowlist({ version: 1, entries: [partial] }), new RegExp(`missing "${field}"`));
  }
  assert.throws(() => assertAllowlist({ version: 2, entries: [] }), /Unsupported/);
});

test("the committed allowlist itself satisfies the review contract", async () => {
  const { readFile } = await import("node:fs/promises");
  const raw = JSON.parse(await readFile(new URL("./retired-vocabulary-allowlist.json", import.meta.url), "utf8"));
  const entries = assertAllowlist(raw);
  assert.ok(entries.length > 0);
  // Every exemption must name the review that approved it, so the file cannot
  // accumulate entries nobody signed off on.
  for (const entry of entries) assert.match(entry.reviewed, /AP-\d+/);
});
