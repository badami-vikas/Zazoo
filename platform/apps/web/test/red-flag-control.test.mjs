import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";

const redFlagControlUrl = new URL("../src/app/components/shared/RedFlagControl.tsx", import.meta.url);
const redFlagProviderUrl = new URL("../src/app/components/shared/RedFlagProvider.tsx", import.meta.url);
const tableViewUrl = new URL("../src/app/dataviews/views/TableView.tsx", import.meta.url);
const eligibilityUrl = new URL("../src/app/dataviews/eligibility.ts", import.meta.url);
const jobPilotDetailUrl = new URL("../src/app/pages/JobPilotApplicationDetail.tsx", import.meta.url);
const flagIconUrl = new URL("../src/app/components/shared/FlagIcon.tsx", import.meta.url);
const dataJobpilotUrl = new URL("../src/app/data/jobpilot.ts", import.meta.url);

test("RedFlagControl gates visibility on POINTER CAPABILITY (not viewport width), keeps a >=44px touch hit target on ANY coarse pointer, aria-pressed, and the popover", async () => {
  const source = await readFile(redFlagControlUrl, "utf8");
  assert.match(source, /group-hover\/rf:opacity-100/);
  assert.match(source, /group-focus-within\/rf:opacity-100/);
  // review item 8: pointer capability, never a viewport-width breakpoint.
  assert.match(source, /\[@media\(hover:none\)\]:opacity-60/);
  assert.doesNotMatch(source, /max-\[\d+px\]:opacity/, "must not gate visibility on a viewport-width breakpoint");
  assert.match(source, /\[@media\(pointer:coarse\)\]:before:-inset-3\.5/, "the touch hit target must be enlarged via an invisible overlay, not a viewport check");
  // review round-4 item 10: a coarse pointer that ISN'T the OS's declared
  // PRIMARY pointer (e.g. a touchscreen alongside an attached mouse) must
  // ALSO get the enlarged hit target and the persistent-visibility
  // treatment — `(pointer: coarse)` alone only covers the primary pointer.
  assert.match(source, /\[@media\(any-pointer:coarse\)\]:before:-inset-3\.5/, "the touch hit target must ALSO expand under any-pointer:coarse (hybrid touch+mouse devices)");
  assert.match(source, /\[@media\(any-pointer:coarse\)\]:opacity-60/, "visibility must ALSO persist under any-pointer:coarse");
  assert.match(source, /aria-pressed=\{isOpen\}/);
  assert.match(source, /role="menu"/);
  // Never overloads color for anything but this ONE flag — red only when open.
  assert.match(source, /var\(--danger\)/);
});

test("RedFlagControl serializes reason-save against clear/reopen/forget, skips saving an unchanged reason, and chains clear/reopen/forget off the SAVE's own returned id (review items 4 + round-4 item 9)", async () => {
  const source = await readFile(redFlagControlUrl, "utf8");
  assert.match(source, /pendingSaveRef/);
  assert.match(source, /reasonDraft === reason\)\s*return current\.row\.id;/, "an unchanged reason must not trigger a save, and must still resolve to the current (already-fresh) id");
  assert.match(source, /afterPendingSave\(\)/);
  // review round-4 item 9: every action after a possible reason-save must
  // use the id afterPendingSave() RESOLVES TO — never a stale closure
  // `current.row.id` captured before the save started.
  assert.match(source, /const flagId = await afterPendingSave\(\);/g);
  assert.doesNotMatch(source, /await ctx\.clear\(current\.row\.id\)/, "clear must not act on a stale closure id — it must use afterPendingSave()'s resolved id");
  assert.doesNotMatch(source, /await ctx\.reopen\(current\.row\.id\)/, "reopen must not act on a stale closure id — it must use afterPendingSave()'s resolved id");
});

test("RedFlagControl is a context CONSUMER (no per-mount fetch) — the batched query lives in RedFlagProvider (review item 7)", async () => {
  const controlSource = await readFile(redFlagControlUrl, "utf8");
  assert.match(controlSource, /useRedFlagContext/);
  assert.doesNotMatch(controlSource, /trpc\.redFlag\./, "RedFlagControl must not call trpc.redFlag directly — only through the provider's context");

  const providerSource = await readFile(redFlagProviderUrl, "utf8");
  for (const proc of ["create", "clear", "reopen", "updateReason", "forget", "listForScope", "enactCorrection", "revokeCorrection"]) {
    assert.match(providerSource, new RegExp(`trpc\\.redFlag\\.${proc}\\.`));
  }
  assert.match(providerSource, /crypto\.randomUUID\(\)/, "create() must supply a client-generated idempotency operationId");
});

test("RedFlagProvider applies every mutation's own returned row to its LOCAL cache synchronously, never solely waiting on a background refetch (review round-4 item 9)", async () => {
  const source = await readFile(redFlagProviderUrl, "utf8");
  assert.match(source, /function applyLocally/);
  assert.match(source, /setRows\(/);
  // Every mutation must route through applyLocally (or, for forget, its own
  // synchronous removal) rather than solely calling refresh() and
  // discarding the mutation's own returned row.
  assert.match(source, /create: async \(input\) => \{[\s\S]*?applyLocally\(memory\)/);
  assert.match(source, /clear: async \(flagId\) => \{[\s\S]*?applyLocally\(memory\)/);
  assert.match(source, /reopen: async \(flagId\) => \{[\s\S]*?applyLocally\(memory\)/);
  assert.match(source, /updateReason: async \(flagId, reason\) => \{[\s\S]*?applyLocally\(memory\)/);
  assert.match(source, /forget: async \(flagId\) => \{[\s\S]*?setRows\(\(prev\) => \(prev \? prev\.filter/, "forget must synchronously remove the row from the local cache, not just refetch");
});

test("RedFlagControl visibly withholds the flagged value once its correction is 'applied' (review round-4 item 1 — behavior changes only after approval), with an Undo action", async () => {
  const source = await readFile(redFlagControlUrl, "utf8");
  assert.match(source, /isApplied/);
  assert.match(source, /learningStatus === 'applied'/);
  assert.match(source, /corrected, pending re-entry/i);
  assert.match(source, /revokeCorrection/);
  assert.match(source, /Undo correction/);
});

test("TableView requires a STABLE persisted record id — never the sorted row's array index — before wrapping a cell in RedFlagControl (review round-4 item 6)", async () => {
  const [tableSource, eligibilitySource] = await Promise.all([readFile(tableViewUrl, "utf8"), readFile(eligibilityUrl, "utf8")]);
  assert.match(tableSource, /import \{ RedFlagControl \} from ["'].*RedFlagControl\.js["']/);
  assert.match(tableSource, /import \{ RedFlagProvider \} from ["'].*RedFlagProvider\.js["']/);
  assert.match(tableSource, /<RedFlagProvider scope=\{\{ moduleId: moduleIdFromDatabaseId\(spec\.id\), databaseId: spec\.id \}\}>/);
  assert.match(tableSource, /isFlaggableValue\(value\)/);
  assert.match(tableSource, /stableRecordId/, "must derive a stable record id, not the sorted row's array index");
  assert.doesNotMatch(tableSource, /recordId = String\(row\["id"\] \?\? i\)/, "must never fall back to the sorted row index as the anchor's recordId");
  assert.match(tableSource, /kind: "cell", moduleId: moduleIdFromDatabaseId\(spec\.id\), databaseId: spec\.id, recordId: stableRecordId, fieldId: col\.id/);
  assert.match(eligibilitySource, /export function isFlaggableValue/);
  assert.match(eligibilitySource, /export function moduleIdFromDatabaseId/);
});

test("JobPilotApplicationDetail wraps rendered bullets in RedFlagProvider scopes and uses the discriminated bullet anchor (cell vs. bullet never conflated)", async () => {
  const source = await readFile(jobPilotDetailUrl, "utf8");
  assert.match(source, /import \{ RedFlagControl \} from ['"]\.\.\/components\/shared\/RedFlagControl['"]/);
  assert.match(source, /import \{ RedFlagProvider \} from ['"]\.\.\/components\/shared\/RedFlagProvider['"]/);
  assert.match(source, /<RedFlagProvider scope=\{\{ moduleId: 'job-pilot', recordId: artifact\.id \}\}>/);
  assert.match(source, /<RedFlagProvider scope=\{\{ moduleId: 'job-pilot', recordId: application\.id \}\}>/);
  assert.match(source, /kind: 'bullet', moduleId: 'job-pilot', target: \{ type: 'record', recordId: artifact\.id \}, bulletPath: `s\$\{i\}\.b\$\{j\}`/);
  assert.match(source, /kind: 'bullet', moduleId: 'job-pilot', target: \{ type: 'record', recordId: application\.id \}, bulletPath: `fit\.strength\.\$\{i\}`/);
  assert.match(source, /kind: 'bullet', moduleId: 'job-pilot', target: \{ type: 'record', recordId: application\.id \}, bulletPath: `fit\.concern\.\$\{i\}`/);
});

test("the pre-canon green/yellow/red FlagIcon and its dead fixture duplicate are removed (AP-023)", async () => {
  await assert.rejects(() => access(flagIconUrl), /ENOENT/);
  await assert.rejects(() => access(dataJobpilotUrl), /ENOENT/);
});

test("Settings > Learning surfaces a paginated Flags audit section (review item 6 — cursor, not silent truncation)", async () => {
  const source = await readFile(new URL("../src/app/pages/SettingsPage.tsx", import.meta.url), "utf8");
  assert.match(source, /trpc\.redFlag\.listAll\.query/);
  assert.match(source, /trpc\.redFlag\.clear\.mutate/);
  assert.match(source, /trpc\.redFlag\.reopen\.mutate/);
  assert.match(source, /trpc\.redFlag\.forget\.mutate/);
  assert.match(source, /nextCursor/);
  assert.match(source, /loadMoreFlags/);
});

test("no green/yellow feedback-flag semantics remain in DealPilot/JobPilot fit rendering", async () => {
  const dealPilotPage = await readFile(new URL("../src/app/pages/DealPilotPage.tsx", import.meta.url), "utf8");
  const jobPilotPage = await readFile(new URL("../src/app/pages/JobPilotPage.tsx", import.meta.url), "utf8");
  for (const source of [dealPilotPage, jobPilotPage]) {
    assert.doesNotMatch(source, /["']green["']/);
    assert.doesNotMatch(source, /["']yellow["']/);
    assert.doesNotMatch(source, /FlagIcon/);
  }
});
