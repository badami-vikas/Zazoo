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

  // Second Brain — the cross-Module full Graph preset (ADR-110). `graph.full`
  // composes ONLY `graphStore.listFullGraph` + `moduleStore.list` (router.ts:11799),
  // i.e. the same DrizzleGraphStore/DrizzleModuleStore already served by
  // `relationship.*` and `modules.list` above. No Local Plane, credential, or raw
  // capture access. `relationship.proposeSignalAction` — the Graph's node Action —
  // stays CLOSED: it proposes with `dataScope: "private"` (router.ts:9172), which
  // the public shell does not serve.
  "graph.full",
]);

export function isPublicCloudOnly(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.BRIDGE_LOCAL_RESIDENCY === PUBLIC_CLOUD_RESIDENCY;
}

export function isPublicCloudProcedureAllowed(path: string): boolean {
  return PUBLIC_CLOUD_PROCEDURES.has(path);
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
