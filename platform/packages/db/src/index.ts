/**
 * @bridge/db — Drizzle schema (mirror of docs/raw/SCHEMA.sql), client factory,
 * and core port bindings (the Drizzle-backed LedgerStore).
 */
export * as schema from "./schema.js";
export { createDb, type Database, type DbConfig } from "./client.js";
export { createLocalDb, type LocalDatabase, type LocalDbConfig } from "./client-local.js";
export { assertRlsPosture, type RlsEnvironment, type RlsPostureOptions, type RlsRoleAttributes } from "./rls-guard.js";
export { DrizzleLedgerStore } from "./ledger-store.js";
export {
  DrizzleRoleStore,
  DrizzleAgentStore,
  DrizzleEphemeralStore,
  DrizzlePolicyStore,
} from "./governance-stores.js";
export { DrizzleRitualRegistry, DrizzleToolRegistry, DrizzleRitualRunRecorder } from "./ritual-stores.js";
export {
  DrizzleCanonicalIdentityStore,
  InMemoryCanonicalIdentityStore,
  type CanonicalIdentityStore,
  type CanonicalPersonIdentity,
  type UpsertResult,
} from "./canonical-store.js";
export {
  DrizzleIntegrationStore,
  IntegrationFloorScopeError,
  ALWAYS_APPROVAL_SCOPES,
  INTEGRATION_ACTOR_TYPE,
  type IntegrationRow,
  type ScopeGrant,
} from "./integration-store.js";
export { PgliteMediaStore, createLocalMediaStore } from "./media-store.js";
export { DrizzleWorkspaceStore, type WorkspaceRow, type MemberRow } from "./workspace-store.js";
export { DrizzleGraphStore, type PageOpts, type Page } from "./graph-store.js";
export { DrizzleJobPilotStore, type JobRow, type ApplicationRow, type CreateJobInput } from "./jobpilot-store.js";
export { DrizzleHelpdeskStore, type TicketRow, type MessageRow } from "./helpdesk-store.js";
export { DrizzleResourcesStore, type ResourceRow, type CreateResourceInput as CreateResourceStoreInput } from "./resources-store.js";
export {
  DrizzleCapabilityStore,
  parseDependencies,
  parseEvidence,
} from "./capability-store.js";
export {
  DrizzleWorkspaceDefinitionStore,
  parseBlueprint,
  workspaceBlueprintSchema,
} from "./workspace-definition-store.js";
export { DrizzlePackageStore, parsePackageManifestRow } from "./package-store.js";

import type { Database as Db } from "./client.js";
import { DrizzleLedgerStore } from "./ledger-store.js";
import {
  DrizzleAgentStore,
  DrizzleEphemeralStore,
  DrizzlePolicyStore,
  DrizzleRoleStore,
} from "./governance-stores.js";
import {
  DrizzleRitualRegistry,
  DrizzleToolRegistry,
  DrizzleRitualRunRecorder,
} from "./ritual-stores.js";
import { DrizzleWorkspaceStore } from "./workspace-store.js";

/** All Drizzle-backed ports, ready to hand to the core pipeline + executor. */
export function createDrizzlePorts(db: Db) {
  return {
    roles: new DrizzleRoleStore(db),
    agents: new DrizzleAgentStore(db),
    ephemeral: new DrizzleEphemeralStore(db),
    policies: new DrizzlePolicyStore(db),
    ledger: new DrizzleLedgerStore(db),
    ritualRegistry: new DrizzleRitualRegistry(db),
    toolRegistry: new DrizzleToolRegistry(db),
    ritualRunRecorder: new DrizzleRitualRunRecorder(db),
    workspaceStore: new DrizzleWorkspaceStore(db),
  };
}
