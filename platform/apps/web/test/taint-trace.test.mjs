import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const approvals = readFileSync(
  resolve(here, "../src/app/pages/ApprovalsPage.tsx"),
  "utf8",
);
const ledger = readFileSync(
  resolve(here, "../src/app/data/ledger.ts"),
  "utf8",
);

test("Approvals renders untrusted and unknown warnings with an inspectable trace", () => {
  assert.match(approvals, /Influenced by untrusted content/);
  assert.match(approvals, /Taint unknown — quarantined/);
  assert.match(approvals, /Taint trace/);
  assert.match(approvals, /originChain\.map/);
  assert.match(approvals, /No classified source chain is available; this proposal remains quarantined\./);
});

test("taint trace is parsed from the authenticated Ledger response, not display fixtures", () => {
  assert.match(ledger, /asTaintLabel\(row\.taintLabel\)/);
  assert.match(
    ledger,
    /output\?\.taintLabel \?\? proposal\.request\.taintLabel/,
  );
});

test("Approvals detail retains its narrow-screen width contract", () => {
  assert.match(
    approvals,
    /w-full shrink-0 sm:w-auto sm:min-w-0 sm:flex-1/,
  );
  assert.match(approvals, /min-w-0 flex-1 flex flex-col/);
});
