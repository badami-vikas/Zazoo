import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";

const redFlagControlUrl = new URL("../src/app/components/shared/RedFlagControl.tsx", import.meta.url);
const tableViewUrl = new URL("../src/app/dataviews/views/TableView.tsx", import.meta.url);
const eligibilityUrl = new URL("../src/app/dataviews/eligibility.ts", import.meta.url);
const jobPilotDetailUrl = new URL("../src/app/pages/JobPilotApplicationDetail.tsx", import.meta.url);
const flagIconUrl = new URL("../src/app/components/shared/FlagIcon.tsx", import.meta.url);
const dataJobpilotUrl = new URL("../src/app/data/jobpilot.ts", import.meta.url);

test("RedFlagControl exposes hover/focus reveal, aria-pressed, and a touch-persistent variant (§5d)", async () => {
  const source = await readFile(redFlagControlUrl, "utf8");
  assert.match(source, /group-hover\/rf:opacity-100/);
  assert.match(source, /group-focus-within\/rf:opacity-100/);
  assert.match(source, /max-\[767px\]:opacity-60/);
  assert.match(source, /aria-pressed=\{isOpen\}/);
  assert.match(source, /role="menu"/);
  // Never overloads color for anything but this ONE flag — red only when open.
  assert.match(source, /var\(--danger\)/);
});

test("RedFlagControl's create/clear/reopen/updateReason/forget all call the platform redFlag router (no duplicate feedback subsystem)", async () => {
  const source = await readFile(redFlagControlUrl, "utf8");
  for (const proc of ["create", "clear", "reopen", "updateReason", "forget", "listForAnchor"]) {
    assert.match(source, new RegExp(`trpc\\.redFlag\\.${proc}\\.`));
  }
});

test("TableView wraps eligible cells with RedFlagControl, gated by isFlaggableValue", async () => {
  const [tableSource, eligibilitySource] = await Promise.all([readFile(tableViewUrl, "utf8"), readFile(eligibilityUrl, "utf8")]);
  assert.match(tableSource, /import \{ RedFlagControl \} from ["'].*RedFlagControl\.js["']/);
  assert.match(tableSource, /isFlaggableValue\(value\)/);
  assert.match(tableSource, /<RedFlagControl anchor=/);
  assert.match(eligibilitySource, /export function isFlaggableValue/);
});

test("JobPilotApplicationDetail wraps rendered bullets (section bullets, fit strengths/concerns) with RedFlagControl", async () => {
  const source = await readFile(jobPilotDetailUrl, "utf8");
  assert.match(source, /import \{ RedFlagControl \} from ['"]\.\.\/components\/shared\/RedFlagControl['"]/);
  assert.match(source, /bulletPath: `s\$\{i\}\.b\$\{j\}`/);
  assert.match(source, /bulletPath: `fit\.strength\.\$\{i\}`/);
  assert.match(source, /bulletPath: `fit\.concern\.\$\{i\}`/);
});

test("the pre-canon green/yellow/red FlagIcon and its dead fixture duplicate are removed (AP-023)", async () => {
  await assert.rejects(() => access(flagIconUrl), /ENOENT/);
  await assert.rejects(() => access(dataJobpilotUrl), /ENOENT/);
});

test("Settings > Learning surfaces a Flags audit section powered by redFlag.listAll (inspect the audit evidence)", async () => {
  const source = await readFile(new URL("../src/app/pages/SettingsPage.tsx", import.meta.url), "utf8");
  assert.match(source, /trpc\.redFlag\.listAll\.query/);
  assert.match(source, /trpc\.redFlag\.clear\.mutate/);
  assert.match(source, /trpc\.redFlag\.reopen\.mutate/);
  assert.match(source, /trpc\.redFlag\.forget\.mutate/);
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
