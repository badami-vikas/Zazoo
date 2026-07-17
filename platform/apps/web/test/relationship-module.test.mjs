import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("../src/app/routes.tsx", import.meta.url), "utf8");
const relationshipPage = readFileSync(new URL("../src/app/pages/RelationshipPage.tsx", import.meta.url), "utf8");
const relationshipHelpdesk = readFileSync(new URL("../src/app/pages/RelationshipHelpdeskPage.tsx", import.meta.url), "utf8");
const publicHelpdesk = readFileSync(new URL("../src/app/pages/PublicHelpdesk.tsx", import.meta.url), "utf8");
const approvalsPage = readFileSync(new URL("../src/app/pages/ApprovalsPage.tsx", import.meta.url), "utf8");
const signalsPage = readFileSync(new URL("../src/app/pages/SignalsPage.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/Layout.tsx", import.meta.url), "utf8");
const trpcClient = readFileSync(new URL("../src/app/lib/trpc.ts", import.meta.url), "utf8");
const pagination = readFileSync(new URL("../src/app/lib/pagination.ts", import.meta.url), "utf8");
const ledgerData = readFileSync(new URL("../src/app/data/ledger.ts", import.meta.url), "utf8");
const toolDetail = readFileSync(new URL("../src/app/pages/ToolDetail.tsx", import.meta.url), "utf8");
const builtIns = readFileSync(new URL("../../api/src/built-in-packages.ts", import.meta.url), "utf8");

test("Relationship is one installed Module with canonical primary Pages", () => {
  assert.match(builtIns, /name: "relationship"/);
  assert.match(builtIns, /relationship\.page\.signals/);
  assert.match(builtIns, /relationship\.page\.people/);
  assert.match(builtIns, /relationship\.page\.communities/);
  assert.match(builtIns, /relationship\.submodule\.helpdesk/);
  assert.doesNotMatch(builtIns, /name: "helpdesk"/);
});

test("Relationship routes are deep linked and legacy global surfaces are absent", () => {
  assert.match(routes, /module\/relationship\/signals\/:signalId\/event/);
  assert.match(routes, /module\/relationship\/people\/:recordId/);
  assert.match(routes, /module\/relationship\/communities\/:recordId/);
  assert.match(routes, /module\/relationship\/helpdesk\/:ticketId/);
  assert.match(routes, /module\/relationship\/:page/);
  assert.doesNotMatch(routes, /path: "knowledge-base"/);
  assert.doesNotMatch(routes, /path: "signals"/);
  assert.doesNotMatch(routes, /path: "helpdesk"/);
});

test("nested Helpdesk uses the workspace-scoped API instead of the legacy local store", () => {
  assert.match(relationshipHelpdesk, /trpc\.helpdesk\.list/);
  assert.match(relationshipHelpdesk, /trpc\.helpdesk\.get/);
  assert.match(relationshipHelpdesk, /trpc\.helpdesk\.reply/);
  assert.doesNotMatch(relationshipHelpdesk, /data\/helpdesk/);
});

test("public Helpdesk converges on canonical ticket and token-thread procedures", () => {
  assert.match(publicHelpdesk, /trpc\.helpdesk\.public\.createTicket/);
  assert.match(publicHelpdesk, /trpc\.helpdesk\.public\.getThread/);
  assert.match(publicHelpdesk, /trpc\.helpdesk\.public\.reply/);
  assert.match(publicHelpdesk, /operationId: operation\.operationId/);
  assert.match(publicHelpdesk, /\.pending-create/);
  assert.match(publicHelpdesk, /id="public-helpdesk-recovery-key"/);
  assert.match(publicHelpdesk, /onFocus=\{\(event\) => event\.currentTarget\.select\(\)\}/);
  assert.match(publicHelpdesk, /setKeyStored\(false\)/);
  assert.ok(
    publicHelpdesk.indexOf("setAccessToken(token)") < publicHelpdesk.indexOf("localStorage.setItem(storageKey, token)"),
    "the one-time key must be rendered before best-effort browser persistence",
  );
  assert.doesNotMatch(publicHelpdesk, /helpdeskRemote|data\/helpdesk/);
});

test("Approvals loads and resolves proposals through the authenticated Action Pipeline", () => {
  assert.match(approvalsPage, /loadPendingApprovals/);
  assert.match(approvalsPage, /await proposeToLedger/);
  assert.match(approvalsPage, /await recordDecisionAppend/);
  assert.doesNotMatch(approvalsPage, /loadLedger/);
  assert.doesNotMatch(approvalsPage, /API_ENABLED/);
  assert.match(ledgerData, /trpc\.action\.listHistory/);
  assert.match(ledgerData, /refLedgerId/);
  assert.match(ledgerData, /proposal_id/);
  assert.match(ledgerData, /canonicalDecisionPrecedes/);
  assert.match(ledgerData, /candidateSequence < currentSequence/);
  assert.match(ledgerData, /LEDGER_READ_WINDOW = 500/);
  assert.doesNotMatch(ledgerData, /collectAllPages/);
  assert.doesNotMatch(ledgerData, /\.from\(['"]ledger['"]\)/);
  assert.match(ledgerData, /normalizeDecision/);
  assert.match(ledgerData, /isReviewDecision/);
  assert.match(ledgerData, /isRejectedAuditRow/);
  assert.match(ledgerData, /trpc\.action\.resolution/);
  assert.match(ledgerData, /case 'relation'/);
  assert.match(ledgerData, /originalRecord\?\.kind === 'relationship_signal_evidence'/);
  assert.match(ledgerData, /JSON\.parse\(nextText\)/);
  assert.match(approvalsPage, /getActions\(\)/);
});

test("failed capture adoption remains pending and exposes an actionable error", () => {
  assert.match(toolDetail, /if \(outcome\)/);
  assert.match(toolDetail, /could not be reconciled with Approvals\. It remains pending/);
  assert.match(toolDetail, /could not be dismissed\. It remains pending/);
  assert.match(
    readFileSync(new URL("../src/app/data/toolCaptures.ts", import.meta.url), "utf8"),
    /return !error && Boolean\(data\)/,
  );
  assert.doesNotMatch(toolDetail, /Routed \$\{c\.person\.name \|\| 'capture'\} \(local\)/);
});

test("Signal detail exposes participant, Event, and governed Action paths", () => {
  assert.match(relationshipPage, /detail\.participants\.map/);
  assert.match(relationshipPage, /detail\.sourceEvent/);
  assert.match(relationshipPage, /proposeSignalAction/);
  assert.match(relationshipPage, /participants\.some\(participant => participant\.relationType === "participant"/);
  assert.match(relationshipPage, /Universal Action Pipeline/);
});

test("375px shell keeps installed Modules reachable", () => {
  assert.match(layout, /aria-controls="mobile-module-menu"/);
  assert.match(layout, /Installed Modules/);
  assert.match(layout, /installedModules\.map/);
});

test("private Relationship requests forward the authenticated Supabase session", () => {
  assert.match(trpcClient, /supabase\.auth\.getSession/);
  assert.match(trpcClient, /authorization: `Bearer \$\{token\}`/);
  assert.match(trpcClient, /headers: trpcAuthorizationHeaders/);
  assert.match(trpcClient, /methodOverride: "POST"/);
});

test("Signal list Actions open evidence detail and preserve the list on row failures", () => {
  assert.doesNotMatch(signalsPage, /proposeSignalAction/);
  assert.match(signalsPage, /to=\{`\/module\/relationship\/signals\/\$\{s\.id\}`\}/);
  assert.match(signalsPage, /actionErrors\[s\.id\]/);
});

test("Relationship lists paginate through the complete accessible result set", () => {
  assert.match(pagination, /while \(true\)/);
  assert.match(relationshipPage, /collectAllPages/);
  assert.match(relationshipHelpdesk, /collectAllPages/);
  assert.match(signalsPage, /collectAllPages/);
});
