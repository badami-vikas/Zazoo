/**
 * @bridge/api — Fastify + tRPC surface over the Universal Action Pipeline.
 * Exports the router type for end-to-end type-safe clients (the web app).
 */
export { appRouter, type AppRouter } from "./router.js";
export { buildServer } from "./server.js";
export { buildWiring, type Wiring } from "./wiring.js";
export type { ApiContext } from "./context.js";
// Universal Commons fetch adapter over @bridge/core's CommonsRegistry port —
// local service today, Bridge Cloud later (COMMONS_URL config-only swap).
export { HttpCommonsClient, commonsUrlFromEnv, DEFAULT_COMMONS_URL } from "./commons-client.js";
