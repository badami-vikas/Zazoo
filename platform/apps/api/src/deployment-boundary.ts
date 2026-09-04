import { isAbsolute, relative, resolve, sep } from "node:path";

const PUBLIC_CLOUD_RESIDENCY = "public-cloud";
const RENDER_HOST_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Procedures permitted in `public-cloud` mode.
 *
 * The public-cloud API is a thin public shell. A procedure is allowed here ONLY
 * when it resolves exclusively to Cloud-Plane (Supabase / Drizzle) stores under
 * the caller's authenticated identity + `bridge_app` RLS, and never touches the
 * Local Plane, the Source credential vault, or raw capture bodies (which stay on
 * the desktop). See AP-082 / ADR-140 for the boundary-relaxation decision.
 *
 * Cloud-Plane-backed modules served here (verified against `wiring.ts`):
 *   - Task Manager  → `DrizzleTaskManagerStore(db)`  (wiring.ts:3333/3370)
 *   - Relationship  → `DrizzleGraphStore(db)`         (wiring.ts:3354)
 *   - JobPilot      → `DrizzleJobPilotStore(db)`      (wiring.ts:3355)
 *   - DealPilot     → `DrizzleDealPilotStore(db)`     (ADR-151, AP-083) — the
 *     RECORD half only (Deal/Source/Thesis Records + Relations). In public-cloud
 *     mode `wiring.dealpilot.store` is the `cloudRecordsDealPilotStore` composite,
 *     which resolves these procedures to Supabase and REFUSES every capture /
 *     credential op.
 *
 * DEALPILOT capture + credential surfaces stay CLOSED: `dealpilot.captures`,
 * `dealpilot.commit`, `dealpilot.discoverDeals`, and the credential-bearing branch
 * of `dealpilot.createSource` all touch Source credentials or raw capture bodies
 * that must never leave the device (canon: "raw capture stays Local"). Those move
 * to the cloud only in the separately-governed Phase E. Module Files,
 * OAuth/integration, and local-plane chat likewise stay closed.
 *
 * Second Brain (`graph.full`) is served here under AP-085 / ADR-153 for the same
 * reason the `relationship.*` reads are: it reads only Cloud-Plane stores.
 */
const PUBLIC_CLOUD_PROCEDURES = new Set([
  // Governed Actions (public data scope only — enforced in the router) + auth/catalog shell.
  "action.propose",
  "action.decide",
  "chat.model.status",
  "chat.thread.create",
  // Repointing a thread at a different engine, resuming a Module's live
  // thread, and attaching another Module all read and write the SAME
  // owner-scoped chat_threads rows thread.create already serves, under the
  // caller's identity and RLS. In public cloud no agentic backend is
  // registered, so setBackend's only reachable value is the built-in one.
  "chat.thread.setBackend",
  "chat.thread.forModule",
  "chat.thread.attachModule",
  "chat.thread.list",
  "chat.thread.get",
  "chat.thread.archive",
  "chat.thread.delete",
  "chat.turn.prepareCloud",
  "chat.turn.send",
  "chat.turn.retry",
  "chat.turn.cancel",
  "health",
  "modules.list",
  // TASK-062 saved Views: `view_configs` is a Cloud-Plane Drizzle store read
  // and written under the caller's identity and FORCE RLS, exactly like
  // chat_threads. Every Module page renders through <DataViews>, so closing
  // these here would leave the public shell with a List control that cannot
  // load — a dead control, not a smaller boundary.
  "view.saved.list",
  "view.saved.save",
  "view.saved.update",
  "view.saved.remove",
  // TASK-064 — share grants over a saved View. Same reasoning as the Views
  // themselves: Cloud-Plane rows under the caller's identity and RLS, with the
  // grant predicate enforced by the database rather than by this shell.
  "view.share.list",
  "view.share.grant",
  "view.share.revoke",
  "view.share.resolve",
  "organization.activateSession",
  "organization.list",

  // Task Manager — Cloud-Plane (DrizzleTaskManagerStore); no Local Plane in these handlers.
  "taskManager.list",
  "taskManager.get",
  "taskManager.create",
  "taskManager.transition",
  "taskManager.decideProposal",

  // Relationship — Cloud-Plane (DrizzleGraphStore); no Local Plane in these handlers.
  "relationship.listPeople",
  "relationship.createPerson",
  "relationship.updatePerson",
  "relationship.listCommunities",
  "relationship.createCommunity",
  "relationship.updateCommunity",
  "relationship.listSignals",
  "relationship.recordSignalAction",

  // JobPilot — Cloud-Plane (DrizzleJobPilotStore). Read + track/move applications.
  "jobpilot.list",
  "jobpilot.definition",
  "jobpilot.create",
  "jobpilot.transition",
  // TASK-076 onboarding: tracks the chosen resume file NAME and ranked job
  // functions in the same Cloud-Plane jobpilot store (jobpilot_candidate_profiles,
  // migration 0043); the resume FILE itself rides the modules.addFile path,
  // which keeps its own classification.
  "jobpilot.onboarding.get",
  "jobpilot.onboarding.saveResume",
  "jobpilot.onboarding.complete",

  // DealPilot — Cloud-Plane RECORD half (DrizzleDealPilotStore via the
  // cloudRecordsDealPilotStore composite). Record read/create/update only;
  // `createSource`'s credential branch self-refuses in public cloud, and the
  // capture/commit/discover procedures below stay CLOSED (raw capture stays Local).
  "dealpilot.module",
  "dealpilot.records",
  "dealpilot.detail",
  "dealpilot.createDeal",
  "dealpilot.createSource",
  "dealpilot.createThesis",
  "dealpilot.updateDeal",
  "dealpilot.updateSource",

  // Academics — Cloud-Plane (DrizzleAcademicsStore), organizationId-scoped
  // like jobpilot/relationship above. No Local Plane in these handlers; raw
  // lecture capture (TASK-067 later phase) is a Skill, not this CRUD router.
  "academics.createSubject",
  "academics.listSubjects",
  "academics.updateSubject",
  "academics.createLectureSession",
  "academics.listLectureSessions",
  "academics.updateLectureSession",
  "academics.createAssignment",
  "academics.listAssignments",
  "academics.updateAssignment",

  // Events (NetworkManager sub-module, TASK-068) — Cloud-Plane
  // (DrizzleEventsStore), organizationId-scoped. Speaker extraction is a
  // later phase and not part of this CRUD router.
  "events.create",
  "events.list",
  "events.update",

  // Second Brain — the cross-Module full Graph preset (ADR-110). `graph.full`
  // composes ONLY `graphStore.listFullGraph` + `moduleStore.list` (router.ts:11799),
  // i.e. the same DrizzleGraphStore/DrizzleModuleStore already served by
  // `relationship.*` and `modules.list` above. No Local Plane, credential, or raw
  // capture access. `relationship.proposeSignalAction` — the Graph's node Action —
  // stays CLOSED: it proposes with `dataScope: "private"` (router.ts:9172), which
  // the public shell does not serve.
  "graph.full",
]);

/**
 * Namespaces that are CLOSED in public-cloud mode, each with the reason.
 *
 * Why this exists at all: deny-by-default is the right runtime behaviour, but on its
 * own it is silent. A new procedure that nobody adds to `PUBLIC_CLOUD_PROCEDURES` is
 * simply refused in the cloud, and the first person to learn about it is the user
 * looking at a surface that says "retry". That happened twice in one day — AP-082
 * ("most of the modules are broken") and AP-085 ("2nd brain is not loading") were the
 * same omission, the second one missed because Second Brain is a nav preset rather
 * than a Module.
 *
 * So: every procedure must be classified EXPLICITLY, either allowed above or denied
 * here. `classifyPublicCloudProcedure` returns `"unclassified"` for anything in
 * neither set, and a test fails the build naming it. Silence is no longer an option.
 *
 * Prefixes are matched longest-first, so a specific rule beats a general one.
 *
 * NOTE the deliberate asymmetry: denial may be granted by namespace, but permission is
 * exact-path only. Adding a procedure to an already-closed namespace inherits the
 * closure (safe, and almost always correct). Adding one to an already-OPEN namespace —
 * say a `relationship.deleteEverything` — matches no allow entry and no deny prefix, so
 * it lands as `unclassified` and fails the build. The direction that could leak data
 * therefore cannot be automatic.
 */
const LOCAL_ONLY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  // — Raw capture, credentials, and the Local Plane itself: canon says raw capture stays Local.
  ["capture.", "raw capture bodies never leave the device"],
  ["whatsapp.", "owner's own WhatsApp Web session lives in the desktop webview"],
  ["dealpilot.captures", "raw capture bodies never leave the device"],
  ["dealpilot.commit", "commits raw captures"],
  ["dealpilot.discoverDeals", "drives Source credentials"],
  ["dealpilot.runDiscovery", "crawls broker Sources and returns raw listing bodies"],
  ["dealpilot.list", "enumerates Source credentials"],
  ["dealpilot.accessCredential", "reads a Source credential from the vault"],
  ["dealpilot.clearCredential", "mutates the Source credential vault"],
  ["dealpilot.reauthenticateCredential", "mutates the Source credential vault"],
  ["integration.", "credential broker + connection secrets are Local Plane"],
  ["google.", "OAuth tokens are held in the Local Plane vault"],
  ["devpilot.", "GitHub Personal Access Tokens are held in the Local Plane vault; D1 has no public-cloud value without one"],
  ["chat.model.", "managed local model lifecycle is a desktop-only concern"],
  // TASK-082: a microphone recording is raw capture. It is forwarded to the
  // STT provider and never stored, but routing a user's microphone through a
  // shared public shell is exactly the boundary "raw capture stays Local"
  // draws. `chat.model.status.composer.voice` states this on the control.
  ["chat.voice.", "a microphone recording is raw capture and stays on the Local Plane"],
  ["modelProviderKey.", "model-provider API keys are held in the Local Plane vault"],

  // — Governance/authoring surfaces: writing capability or authority state from a public
  //   shell would move the trust boundary, not just serve data.
  ["capability.", "capability trust-state authoring is governed, desktop-only"],
  ["builder.", "a Builder Run writes files and runs commands in the user's own Bridge folder"],
  ["agent.", "Agent authoring changes who may act"],
  ["automation.", "Automation authoring grants a trigger the right to start Runs"],
  ["commons.", "Commons publication is an External-band action"],
  ["moduleGovernance.", "the per-Module governance overlay (TASK-088) is Local-Plane state, and editing what a Module is allowed to do moves the trust boundary"],
  ["tableSchema.", "the column overlay (TASK-084) is Local-Plane state, and reshaping a Database — or editing a formula that every client's dashboard reads — is a governed, desktop-only authoring action"],
  ["records.", "which Sections a Database's Records show (TASK-083) is Local-Plane state, and a Record note is user content the Local Plane holds — neither has a Cloud-Plane store to serve from"],
  ["organization.create", "Organization lifecycle is not a public-shell action"],
  ["organization.rename", "Organization lifecycle is not a public-shell action"],
  ["organization.inviteMember", "membership changes are not a public-shell action"],
  ["organization.removeMember", "membership changes are not a public-shell action"],
  ["organization.blueprint", "blueprint activation is a governed proposal"],
  ["organization.members", "membership enumeration is not served publicly"],
  ["organization.listMembers", "membership enumeration is not served publicly"],
  ["organization.vocabulary", "Organization vocabulary authoring is desktop-only"],

  // — Learning / Memory: reads and writes personal Memory, which is Local by residency.
  ["learning.", "personal Memory is Local Plane"],
  ["brief.", "the morning brief reads private Local-Plane Memory and commitments"],
  ["onboarding.", "onboarding profile + learning state are Local Plane"],
  ["redFlag.", "red-flag Memory is private, owner-scoped, Local"],
  ["chiefOfStaff.", "routes to Local-Plane skills and Memory"],

  // — Accounting / D2C Modules: both stores open per-user sqlite files under the
  //   user's home Documents (accounting-store.ts / d2c-store.ts dbPath), by their
  //   own design comments "inside the host-granted files root, never @bridge/db".
  //   A public cloud instance has no such per-user filesystem to serve.
  ["accounting.", "the Accounting store is per-user sqlite under the user's Documents"],
  ["d2c.", "the D2C store is per-user sqlite under the user's Documents"],
  ["d2cNotes.", "D2C notes live in the same per-user sqlite as the D2C store"],
  ["d2cResearch.", "D2C research lives in the same per-user sqlite as the D2C store"],

  // — Agent execution: a public shell may PROPOSE and DECIDE (both allowed above), but
  //   never drive Runs, Goals/Tasks, or Skills directly.
  ["agentOrchestration.", "Agent Runs and Skill invocation stay on the device"],
  ["action.proposeOutreachDraft", "egress-capable draft path"],
  ["action.listPending", "enumerates proposals across data scopes"],
  ["action.listHistory", "enumerates proposals across data scopes"],
  ["action.get", "may resolve a private-scope proposal"],
  ["action.enactCorrection", "applies a governed correction"],
  ["action.relationshipProposals", "private relation proposals"],
  ["action.resolution", "resolves a proposal that may carry private scope"],
  ["action.reconcileApproved", "replays approved effects against the Local Plane"],
  ["action.taintTrace", "exposes the runtime taint audit spine"],
  ["action.declassifyInstructionRisk", "declassification is validator/Human-only"],

  // — Module/file surfaces + remaining reads that touch the Local Plane or non-public scope.
  ["modules.files", "Module Files live under ~/Documents/Bridge"],
  ["modules.addFile", "Module Files live under ~/Documents/Bridge"],
  ["modules.rename", "renaming a Module MOVES its ~/Documents/Bridge folder"],
  ["modules.register", "Module registration is a governed install"],
  ["modules.install", "Module registration is a governed install"],
  ["modules.uninstall", "Module registration is a governed install"],
  ["modules.get", "resolves Module attachment + Commons provenance"],
  ["modules.attach", "Commons attachment is an External-band action"],
  ["modules.detach", "Commons attachment is an External-band action"],
  ["modules.promote", "version promotion changes what every install resolves to"],
  ["modules.rollback", "rollback forks module version history"],
  ["modules.recentRuns", "Agent Run history is Local Plane"],
  ["modules.reconcileApproved", "replays approved installs against the Local Plane"],
  ["relationship.", "the remaining relationship.* surface reads private scope or Local Plane"],
  ["taskManager.", "the remaining taskManager.* surface writes governed structure"],
  ["jobpilot.cultureResearch", "runs governed web research from the device"],
  ["graph.listRecords", "unscoped record enumeration"],
  ["graph.getRecord", "unscoped record read"],
  ["view.", "local geocoder + location resolution stay on the device"],
  ["resources.", "Resources store is Local Plane"],
];

export function isPublicCloudOnly(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.BRIDGE_LOCAL_RESIDENCY === PUBLIC_CLOUD_RESIDENCY;
}

export function isPublicCloudProcedureAllowed(path: string): boolean {
  return PUBLIC_CLOUD_PROCEDURES.has(path);
}

export type PublicCloudClassification =
  | { kind: "allowed" }
  | { kind: "local-only"; reason: string }
  | { kind: "unclassified" };

/**
 * Every tRPC procedure must resolve to `allowed` or `local-only`. `unclassified` is a
 * build failure, not a runtime state — see `LOCAL_ONLY_PREFIXES`.
 */
export function classifyPublicCloudProcedure(
  path: string,
): PublicCloudClassification {
  if (PUBLIC_CLOUD_PROCEDURES.has(path)) return { kind: "allowed" };
  let match: readonly [string, string] | undefined;
  for (const entry of LOCAL_ONLY_PREFIXES) {
    if (!path.startsWith(entry[0])) continue;
    if (!match || entry[0].length > match[0].length) match = entry;
  }
  return match ? { kind: "local-only", reason: match[1] } : { kind: "unclassified" };
}

/** The classified deny list, for tests and audits. */
export function localOnlyPrefixes(): ReadonlyArray<readonly [string, string]> {
  return LOCAL_ONLY_PREFIXES;
}

export function renderWebOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const host = env.BRIDGE_RENDER_WEB_HOST?.trim();
  if (!host) return null;
  if (!RENDER_HOST_RE.test(host)) {
    throw new Error("BRIDGE_RENDER_WEB_HOST must be a bare HTTPS hostname");
  }
  return `https://${host}`;
}

export function isPublicCloudScratchPath(value: string): boolean {
  const root = resolve("/tmp/bridge-public-only");
  const candidate = resolve(value);
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" ||
    (
      pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot)
    );
}
