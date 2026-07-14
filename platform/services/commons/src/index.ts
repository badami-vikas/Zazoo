/**
 * @bridge/commons — Universal Commons, local-first curated package registry.
 * Generalized capability knowledge ONLY — never user data; the privacy gate
 * enforces that at publish time. Same HTTP contract as future Bridge Cloud.
 */
export { buildCommonsServer } from "./server.js";
export { FsCommonsStore, DuplicateVersionError, type CommonsStore } from "./store.js";
export { findWorkspaceDataPaths } from "./privacy-gate.js";
export { resolveCommonsSigningKeyPair, signManifest, ed25519ManifestVerifier, type CommonsSigningKeyPair } from "./signing.js";
