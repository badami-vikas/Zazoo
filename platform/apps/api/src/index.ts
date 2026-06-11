/**
 * @bridge/api — Fastify + tRPC surface over the Universal Action Pipeline.
 * Exports the router type for end-to-end type-safe clients (the web app).
 */
export { appRouter, type AppRouter } from "./router.js";
export { buildServer } from "./server.js";
export { buildWiring, type Wiring } from "./wiring.js";
export type { ApiContext } from "./context.js";
