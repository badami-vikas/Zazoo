/**
 * @bridge/devpilot — the DevPilot Module's domain package. Pure types,
 * normalization, and Table specs only; no network, no credentials, no store.
 * Sync is driven by @bridge/integrations-github through the API's governed
 * `devpilot.syncGithub` Skill; persistence is @bridge/db's
 * DrizzleDevpilotStore. This is the BUILT_IN_SOURCE_REFS provenance target
 * for the "devpilot" built-in Module (see @bridge/module-manifests).
 */
export * from "./domain.js";
export * from "./table.js";
