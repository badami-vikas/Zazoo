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
  for (const proc of ["create", "clear", "reopen", "updateReason", "forget", "listForScope", "enactCorrection", "revokeCorrection", "retryLearning"]) {
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

test("RedFlagControl ships the enactment affordance (review round-5 item 3) — no approved correction may be stranded", async () => {
  const source = await readFile(redFlagControlUrl, "utf8");
  // Approval status is checked ON DEMAND (popover open on a 'proposed' flag),
  // never batched into every page load — must not reintroduce the item-7 N+1.
  assert.match(source, /trpc\.action\.resolution\s*\.query/);
  assert.match(source, /if \(!position \|\| !isProposed \|\| !current\?\.value\.proposalId\) return;/, "the approval check must be gated on the popover actually being open, not fired on mount");
  assert.match(source, /ctx\.enactCorrection\(flagId\)/);
  assert.match(source, /Enact correction/);
  assert.match(source, /approval === 'approved'/, "the Enact button must only render once action.resolution has confirmed approval, not merely learningStatus === 'proposed'");
});

test("RedFlagControl ships a Retry action for a failed governed learning step (review round-5 item 4) — never forces Clear-then-Reopen just to retry", async () => {
  const source = await readFile(redFlagControlUrl, "utf8");
  assert.match(source, /ctx\.retryLearning\(flagId\)/);
  assert.match(source, /learningStatus === 'failed'/);
  assert.match(source, /Retry learning/);
});

test("RedFlagProvider (review round-5 item 11): loading/error are distinct from a genuinely empty scope, last-good rows survive a failed refresh, overlapping refreshes are generation-guarded, and create() is disabled until initial load", async () => {
  const source = await readFile(redFlagProviderUrl, "utf8");
  // A failed refresh must NEVER clobber existing rows with an empty array —
  // only a successful response may call setRows().
  assert.doesNotMatch(source, /\.catch\(\(\) => setRows\(\[\]\)\)/, "a failed refresh must preserve last-good rows, never reset to an empty array");
  assert.match(source, /setError\(true\)/);
  assert.match(source, /error: boolean/, "the context must expose a distinct error flag, not just loading");
  // Generation/abort guard against overlapping refreshes landing out of order.
  assert.match(source, /generationRef/);
  assert.match(source, /if \(generationRef\.current !== generation\) return;/);
  // create() must refuse to run before the FIRST successful load.
  assert.match(source, /if \(rows === null\) \{\s*\n\s*throw new Error/, "create must reject while the batched scope query has never yet succeeded");
  // review round-6 (independent-review follow-up): a failed initial load
  // must expose a way to retry it — otherwise `error: true` + `rows: null`
  // is a permanent dead end with no in-app recovery.
  assert.match(source, /retryLoad: refresh/, "retryLoad must be exposed on the context so a failed initial load can be retried");
});

test("RedFlagControl (review round-5 item 11): the flag glyph is disabled while unflagged AND the provider is still loading (but re-enabled once a load genuinely FAILS, so it isn't stuck forever), and surfaces a create() failure inline", async () => {
  const source = await readFile(redFlagControlUrl, "utf8");
  assert.match(source, /disabled=\{busy \|\| \(!current && ctx\.loading && !ctx\.error\)\}/, "a genuinely FAILED initial load (ctx.error) must re-enable the button rather than disabling it forever");
  assert.match(source, /ctx\.retryLoad\(\)/, "review round-6 (independent-review follow-up on item 11): a failed initial load must expose a way to retry it, not just an inert 'loading' label forever");
  assert.match(source, /createError/);
  assert.match(source, /role="alert"/);
});

test("TableView requires a STABLE persisted record id — never the sorted row's array index — before wrapping a cell in RedFlagControl (review round-4 item 6), and gates rendering on the module being one the server can validate (review round-5 item 6)", async () => {
  const [tableSource, eligibilitySource] = await Promise.all([readFile(tableViewUrl, "utf8"), readFile(eligibilityUrl, "utf8")]);
  assert.match(tableSource, /import \{ RedFlagControl \} from ["'].*RedFlagControl\.js["']/);
  assert.match(tableSource, /import \{ RedFlagProvider \} from ["'].*RedFlagProvider\.js["']/);
  assert.match(tableSource, /isSupportedRedFlagModule/, "must gate on the client-side mirror of the server's validateAnchorTarget allowlist");
  assert.match(tableSource, /flaggable \? <RedFlagProvider scope=\{\{ moduleId, databaseId: spec\.id \}\}>\{table\}<\/RedFlagProvider> : table/);
  assert.match(tableSource, /isFlaggableValue\(value\)/);
  assert.match(tableSource, /stableRecordId/, "must derive a stable record id, not the sorted row's array index");
  assert.doesNotMatch(tableSource, /recordId = String\(row\["id"\] \?\? i\)/, "must never fall back to the sorted row index as the anchor's recordId");
  assert.match(tableSource, /kind: "cell", moduleId, databaseId: spec\.id, recordId: stableRecordId, fieldId: col\.id/);
  assert.match(eligibilitySource, /export function isFlaggableValue/);
  assert.match(eligibilitySource, /export function moduleIdFromDatabaseId/);
  assert.match(eligibilitySource, /export function isSupportedRedFlagModule/);
  assert.doesNotMatch(eligibilitySource, /SUPPORTED_RED_FLAG_MODULES = new Set\(\[[^\]]*"signal"/, "Signal has no backing existence-check store yet — must NOT be in the supported-module allowlist");
});

test("JobPilotApplicationDetail (unrouted, fixture-only) has NO red-flag wiring — a control on non-UUID fixture ids would always fail-closed (review round-5 item 6, AP-021)", async () => {
  const source = await readFile(jobPilotDetailUrl, "utf8");
  assert.doesNotMatch(source, /RedFlagControl/);
  assert.doesNotMatch(source, /RedFlagProvider/);
});

test("JobPilotPage wires REAL cell and bullet Red Flag surfaces — anchored to the persisted application.id, not a fixture", async () => {
  const source = await readFile(new URL("../src/app/pages/JobPilotPage.tsx", import.meta.url), "utf8");
  const tableSource = await readFile(tableViewUrl, "utf8");
  assert.match(source, /import \{ RedFlagControl \} from ["'].*RedFlagControl["']/);
  assert.match(source, /import \{ RedFlagProvider \} from ["'].*RedFlagProvider["']/);
  assert.match(source, /<DataViews/);
  assert.match(source, /id: item\.application\?\.id/);
  assert.match(tableSource, /<RedFlagProvider scope=\{\{ moduleId, databaseId: spec\.id \}\}>/);
  assert.match(tableSource, /kind: "cell"/);
  assert.match(tableSource, /databaseId: spec\.id/);
  assert.match(tableSource, /recordId: stableRecordId/);
  assert.match(tableSource, /fieldId: col\.id/);
  assert.match(source, /<RedFlagProvider scope=\{\{ moduleId: "jobpilot" \}\}>/);
  assert.match(source, /kind: "bullet", moduleId: "jobpilot", target: \{ type: "record", recordId: applicationId \}, bulletPath: "fit\.stage"/);
  assert.match(source, /kind: "bullet", moduleId: "jobpilot", target: \{ type: "record", recordId: applicationId \}, bulletPath: "fit\.flag"/);
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
