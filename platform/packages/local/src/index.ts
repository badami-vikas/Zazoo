/**
 * @bridge/local — the LOCAL plane (customer-controlled private tier).
 *
 * Ports + in-memory adapters (zero infra) + pglite adapters (real persisted local
 * store). OAuth tokens, raw Gmail/Calendar bodies, and derived Events/
 * Memories/Signals live here and NEVER cross the gate to cloud canonical.
 */
export * from "./ports.js";
export { assertMessageShape, assertSenderIdentity } from "./messages.js";
export {
  InMemorySecretStore,
  InMemoryBodyStore,
  InMemoryLocalGraphStore,
  InMemoryLocalStateStore,
  createMemoryLocalPlane,
} from "./stores/memory.js";
export {
  LOCAL_PLANE_PGLITE_EXTENSIONS,
  acquirePgliteDirectoryOwnership,
  createPgliteLocalPlane,
  type PgliteDirectoryOwnership,
  type PgliteLocalPlane,
  type PgliteLocalPlaneConfig,
} from "./stores/pglite.js";
export type { TokenVaultKey, TokenVaultKeys } from "./stores/oauth-token-crypto.js";
