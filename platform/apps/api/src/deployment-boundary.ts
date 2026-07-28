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
 *
 * DEALPILOT stays fully closed: its store is `LocalDealPilotStore(localPlane)`
 * (wiring.ts:4133) — Local-Plane only, no Drizzle store exists — and it also
 * carries Source credentials + raw bodies that must never leave the device.
 * Module Files, OAuth/integration, and local-plane chat likewise stay closed.
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

  // JobPilot — Cloud-Plane (DrizzleJobPilotStore); read-only module surface.
  "jobpilot.list",
  "jobpilot.definition",
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
