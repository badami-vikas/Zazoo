/**
 * @bridge/db — Drizzle schema (mirror of docs/raw/SCHEMA.sql), client factory,
 * and core port bindings (the Drizzle-backed LedgerStore).
 */
export * as schema from "./schema.js";
export { createDb, type Database, type DbConfig } from "./client.js";
export { DrizzleLedgerStore } from "./ledger-store.js";
export {
  DrizzleRoleStore,
  DrizzleAgentStore,
  DrizzleEphemeralStore,
  DrizzlePolicyStore,
} from "./governance-stores.js";
export { DrizzleRitualRegistry, DrizzleToolRegistry, DrizzleRitualRunRecorder } from "./ritual-stores.js";
export { PgliteMediaStore, createLocalMediaStore } from "./media-store.js";

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
  };
}
