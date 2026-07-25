import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("../src/app/routes.tsx", import.meta.url), "utf8");
const relationshipPage = readFileSync(new URL("../src/app/pages/RelationshipPage.tsx", import.meta.url), "utf8");
const relationshipHelpdesk = readFileSync(new URL("../src/app/pages/RelationshipHelpdeskPage.tsx", import.meta.url), "utf8");
const publicHelpdesk = readFileSync(new URL("../src/app/pages/PublicHelpdesk.tsx", import.meta.url), "utf8");
const approvalsPage = readFileSync(new URL("../src/app/pages/ApprovalsPage.tsx", import.meta.url), "utf8");
const signalsPage = readFileSync(new URL("../src/app/pages/SignalsPage.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/Layout.tsx", import.meta.url), "utf8");
const trpcClient = readFileSync(new URL("../src/app/lib/trpc.ts", import.meta.url), "utf8");
const apiAuthorization = readFileSync(
  new URL("../src/app/lib/api-authorization.ts", import.meta.url),
  "utf8",
);
const pagination = readFileSync(new URL("../src/app/lib/pagination.ts", import.meta.url), "utf8");
const ledgerData = readFileSync(new URL("../src/app/data/ledger.ts", import.meta.url), "utf8");
const executionLedger = readFileSync(new URL("../src/app/components/ExecutionLedger.tsx", import.meta.url), "utf8");
const settingsPage = readFileSync(new URL("../src/app/pages/SettingsPage.tsx", import.meta.url), "utf8");
const browserCaptureStore = new URL("../src/app/data/localMedia.ts", import.meta.url);
const builtIns = readFileSync(new URL("../../../modules/manifests/src/index.ts", import.meta.url), "utf8");

test("Relationship is one installed Module with canonical primary Pages", () => {
  assert.match(builtIns, /name: "relationship"/);
  assert.match(builtIns, /relationship\.page\.signals/);
  assert.match(builtIns, /relationship\.page\.people/);
  assert.match(builtIns, /relationship\.page\.communities/);
  assert.match(builtIns, /relationship\.submodule\.relations/);
  assert.match(builtIns, /relationship\.submodule\.interactions/);
  assert.match(builtIns, /relationship\.submodule\.introductions/);
  assert.match(builtIns, /relationship\.submodule\.helpdesk/);
  assert.match(builtIns, /relationship\.submodule\.sources/);
  assert.match(builtIns, /relationship\.help-request\.stage-offer/);
  assert.doesNotMatch(builtIns, /name: "helpdesk"/);
});

test("Relationship routes are deep linked and legacy global surfaces are absent", () => {
  assert.match(routes, /requireBuiltInModule\("relationship"\)/);
  assert.ok(routes.includes("${childPath(relationshipSignalsRoute)}/:signalId/event"));
  assert.ok(routes.includes("${childPath(relationshipModule.route)}/people/:recordId"));
  assert.ok(routes.includes("${childPath(relationshipModule.route)}/communities/:recordId"));
  assert.ok(routes.includes("${childPath(relationshipModule.route)}/helpdesk/:ticketId"));
  for (const path of ["relations", "interactions", "introductions", "sources", ":page"]) {
    assert.ok(routes.includes(`\${childPath(relationshipModule.route)}/${path}`));
  }
  assert.doesNotMatch(routes, /path: "signals"/);
  assert.doesNotMatch(routes, /path: "helpdesk"/);
});

test("nested Helpdesk uses the organization-scoped API instead of the legacy local store", () => {
  assert.match(relationshipHelpdesk, /trpc\.relationship\.helpdesk\.list/);
  assert.match(relationshipHelpdesk, /trpc\.relationship\.helpdesk\.get/);
  assert.match(relationshipHelpdesk, /trpc\.relationship\.helpdesk\.reply/);
  assert.doesNotMatch(relationshipHelpdesk, /data\/helpdesk/);
});

test("public Helpdesk converges on canonical ticket and token-thread procedures", () => {
  assert.match(publicHelpdesk, /trpc\.relationship\.helpdesk\.public\.createTicket/);
  assert.match(publicHelpdesk, /trpc\.relationship\.helpdesk\.public\.getThread/);
  assert.match(publicHelpdesk, /trpc\.relationship\.helpdesk\.public\.reply/);
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
  assert.doesNotMatch(ledgerData, /proposalReferenceFromInputs|proposal_id/);
  assert.match(ledgerData, /canonicalDecisionPrecedes/);
  assert.match(ledgerData, /candidateSequence < currentSequence/);
  assert.match(ledgerData, /LEDGER_READ_WINDOW = 500/);
  assert.doesNotMatch(ledgerData, /collectAllPages/);
  assert.doesNotMatch(ledgerData, /\.from\(['"]ledger['"]\)/);
  assert.match(ledgerData, /normalizeDecision/);
  assert.match(ledgerData, /isReviewDecision/);
  assert.match(ledgerData, /isRejectedAuditRow/);
  assert.match(ledgerData, /trpc\.action\.resolution/);
  assert.match(ledgerData, /trpc\.relationship\.reconcileApproved/);
  assert.match(ledgerData, /trpc\.relationship\.outstandingMaterializations/);
  assert.match(ledgerData, /while \(cursor\)/);
  assert.match(ledgerData, /page\.nextCursor/);
  assert.match(ledgerData, /trpc\.relationship\.retryMaterialization/);
  assert.match(ledgerData, /normalizeDecision\(result\.recordedDecision\)/);
  assert.match(ledgerData, /decision: persistedDecision/);
  assert.match(ledgerData, /originalRecord\?\.kind === 'learning_recommendation'/);
  assert.match(ledgerData, /entry\.proposalOutput = applied\.proposalOutput/);
  assert.match(ledgerData, /commonsAgentActorLabel/);
  assert.match(executionLedger, /Applied after correction/);
  assert.match(executionLedger, /label: 'Automation'/);
  assert.match(executionLedger, /label: 'Record'/);
  assert.match(ledgerData, /case 'relation'/);
  assert.match(ledgerData, /originalRecord\?\.kind === 'relationship_signal_evidence'/);
  assert.match(ledgerData, /JSON\.parse\(nextText\)/);
  assert.match(approvalsPage, /getActions\(\)/);
  assert.match(approvalsPage, /Approved Relationship applications/);
  assert.match(approvalsPage, /Decision is recorded permanently/);
  assert.match(approvalsPage, /Retry application/);
  assert.match(approvalsPage, /crash recovery/);
  assert.doesNotMatch(approvalsPage, /effect\.attempts >= effect\.maxAttempts/);
  assert.match(
    ledgerData,
    /relationshipStatus === 'pending'[\s\S]*?\('pending' as const\)/,
  );
  assert.match(ledgerData, /reconciliation\.status === 'pending'/);
});

test("capture review uses canonical Events instead of the retired standalone surface", () => {
  assert.equal(existsSync(browserCaptureStore), false);
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

test("375px Settings and Approvals keep governed actions in the visible content flow", () => {
  assert.match(settingsPage, /className="sm:hidden shrink-0/);
  assert.match(settingsPage, /id="settings-section"/);
  assert.match(settingsPage, /className="hidden sm:flex w-56/);
  assert.match(settingsPage, /className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-8"/);
  assert.match(approvalsPage, /flex-1 flex flex-col overflow-y-auto sm:flex-row sm:overflow-hidden/);
  assert.match(approvalsPage, /w-full shrink-0 border-b sm:w-\[380px\]/);
  assert.match(approvalsPage, /\[overflow-wrap:anywhere\]/);
  assert.match(executionLedger, /rounded-xl border overflow-x-auto shadow-sm/);
  assert.match(executionLedger, /overflow-x-hidden overflow-y-auto shadow-2xl/);
});

test("private Relationship requests forward the authenticated Supabase session", () => {
  assert.match(trpcClient, /supabase\.auth\.getSession/);
  assert.match(apiAuthorization, /authorization: `Bearer \$\{accessToken\}`/);
  assert.match(trpcClient, /headers: trpcAuthorizationHeaders/);
  assert.match(trpcClient, /methodOverride: "POST"/);
});

test("Signal list Actions open evidence detail and preserve the list on row failures", () => {
  assert.doesNotMatch(signalsPage, /proposeSignalAction/);
  assert.match(signalsPage, /to=\{`\/module\/relationship\/signals\/\$\{selectedSignal\.id\}`\}/);
  assert.match(signalsPage, /actionErrors\[selectedSignal\.id\]/);
  assert.match(signalsPage, /<DataViews/);
});

test("Relationship Record lists use bounded server search and pagination", () => {
  assert.match(pagination, /while \(true\)/);
  assert.doesNotMatch(relationshipPage, /collectAllPages/);
  assert.match(relationshipPage, /trpc\.relationship\.listPeople\.query/);
  assert.match(relationshipPage, /trpc\.relationship\.listCommunities\.query/);
  assert.match(relationshipPage, /setQuery\(search\.trim\(\)\)/);
  assert.match(relationshipPage, /\.\.\.\(query \? \{ query \} : \{\}\)/);
  assert.match(relationshipPage, /setOffset\(offset \+ 50\)/);
  assert.match(relationshipHelpdesk, /collectAllPages/);
  assert.match(signalsPage, /collectAllPages/);
});

test("Relationship Record detail has standard sections and governed Actions", () => {
  assert.match(relationshipPage, /<DataViews/);
  assert.match(relationshipPage, /computeEligibleKinds\(spec\)/);
  assert.match(relationshipPage, /onInsert=\{insertRecord\}/);
  assert.match(relationshipPage, /trpc\.relationship\.createPerson\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.createCommunity\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.updatePerson\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.updateCommunity\.mutate/);
  assert.match(relationshipPage, /includes\("currentTitle"\)/);
  assert.match(relationshipPage, /includes\("description"\)/);
  assert.match(relationshipPage, /includes\("location"\)/);
  assert.match(relationshipPage, /isOwner: record\.isOwner/);
  assert.match(relationshipPage, /canUpdateRow=\{\(row\) => row\["isOwner"\] === true\}/);
  assert.match(relationshipPage, /if \(view\.kind === "form"\)/);
  assert.match(relationshipPage, /trpc\.relationship\.archivePerson\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.archiveCommunity\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.createInteraction\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.timeline\.query/);
  assert.match(relationshipPage, /trpc\.relationship\.intakeReview\.query/);
  assert.match(relationshipPage, /trpc\.relationship\.memories\.query/);
  assert.match(relationshipPage, /trpc\.relationship\.addMemory\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.correctMemory\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.forgetMemory\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.commitments\.query/);
  assert.match(relationshipPage, /trpc\.relationship\.createCommitment\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.updateCommitment\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.meetingPrep\.query/);
  assert.match(relationshipPage, /trpc\.relationship\.introductions\.query/);
  assert.match(relationshipPage, /trpc\.relationship\.createIntroduction\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.recordIntroductionConsent\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.transitionIntroduction\.mutate/);
  assert.match(relationshipPage, /trpc\.relationship\.communityOrganization\.query/);
  assert.match(relationshipPage, /trpc\.relationship\.findPaths\.query/);
  assert.match(relationshipPage, /id="record-overview-title"/);
  assert.match(relationshipPage, /id="record-meeting-prep-title"/);
  assert.match(relationshipPage, /id="record-memory-title"/);
  assert.match(relationshipPage, /id="record-commitments-title"/);
  assert.match(relationshipPage, /id="record-introductions-title"/);
  assert.match(relationshipPage, /id="community-organization-title"/);
  assert.match(relationshipPage, /id="record-connections-title"/);
  assert.match(relationshipPage, /id="record-timeline-title"/);
  assert.match(relationshipPage, /id="record-sources-title"/);
  assert.match(relationshipPage, /provenance\.decisionLedgerIds/);
  assert.match(relationshipPage, /commitment\.provenance\.evidenceRefs/);
  assert.match(relationshipPage, /introduction\.provenance\.evidenceRefs/);
  assert.match(relationshipPage, /Both parties must explicitly consent/);
  assert.match(relationshipPage, /Bridge never sends the introduction/);
});

test("Relationship forms and detail remain responsive and accessible", () => {
  assert.match(relationshipPage, /grid grid-cols-1 gap-4 sm:grid-cols-2/);
  assert.match(relationshipPage, /flex flex-col gap-4 sm:flex-row/);
  assert.match(relationshipPage, /aria-labelledby="identity-review-title"/);
  assert.match(relationshipPage, /aria-label="Event participants"/);
  assert.match(relationshipPage, /aria-label="Meeting preparation actions"/);
  assert.match(relationshipPage, /aria-label="Path target results"/);
  assert.match(relationshipPage, /role="status"/);
  assert.match(relationshipPage, /role="alert"/);
  assert.match(relationshipPage, /aria-expanded=\{editing\}/);
});

test("Relationship Record navigation resets and guards bounded context", () => {
  assert.match(relationshipPage, /const contextGeneration = useRef\(0\)/);
  assert.match(relationshipPage, /requestGeneration\.current !== generation/);
  assert.match(relationshipPage, /const reloadCurrentRecord = \(\) =>/);
  assert.match(relationshipPage, /requestGeneration\.current !== activeGeneration/);
  assert.match(relationshipPage, /contextGeneration\.current !== generation/);
  assert.match(relationshipPage, /setMemories\(\[\]\)/);
  assert.match(relationshipPage, /setCommitmentDraft\(""\)/);
  assert.match(relationshipPage, /key=\{`\$\{kind\}:\$\{recordId\}`\}/);
  assert.match(relationshipPage, /Load more Memory/);
  assert.match(relationshipPage, /Load more commitments/);
  assert.match(relationshipPage, /Load more introductions/);
  assert.match(relationshipPage, /memorySnapshotAt/);
  assert.match(relationshipPage, /commitmentSnapshotAt/);
  assert.match(relationshipPage, /introductionSnapshotAt/);
});

test("datetime-local defaults preserve the browser wall clock", () => {
  assert.match(relationshipPage, /function toDatetimeLocal/);
  assert.match(relationshipPage, /date\.getHours\(\)/);
  assert.match(relationshipPage, /useState\(\(\) => toDatetimeLocal\(new Date\(\)\)\)/);
  assert.doesNotMatch(relationshipPage, /new Date\(\)\.toISOString\(\)\.slice\(0, 16\)/);
});
