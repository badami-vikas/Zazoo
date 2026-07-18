/**
 * @bridge/local — the LOCAL plane (customer-controlled private tier).
 *
 * Ports + in-memory adapters (zero infra) + pglite adapters (real persisted local
 * store). OAuth tokens, raw Gmail/Calendar bodies, and derived Touchpoints/
 * Memories/Signals live here and NEVER cross the gate to cloud canonical.
 */
export * from "./ports.js";
export {
  InMemorySecretStore,
  InMemoryBodyStore,
  InMemoryLocalGraphStore,
  InMemoryLocalStateStore,
  createMemoryLocalPlane,
} from "./stores/memory.js";
export {
  acquirePgliteDirectoryOwnership,
  createPgliteLocalPlane,
  type PgliteDirectoryOwnership,
  type PgliteLocalPlane,
  type PgliteLocalPlaneConfig,
} from "./stores/pglite.js";
