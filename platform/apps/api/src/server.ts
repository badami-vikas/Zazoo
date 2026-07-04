/**
 * Fastify 5 + tRPC 11 server. Boots the pipeline surface with zero infra.
 */
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import { appRouter, type AppRouter } from "./router.js";
import { makeContextFactory } from "./context.js";
import { buildWiring } from "./wiring.js";
import { registerGoogleOAuthRoutes } from "./google-oauth-routes.js";

/**
 * CORS origin resolution. `API_ALLOWED_ORIGINS` (comma-separated) is the explicit
 * allowlist and always wins when set — any origin, any environment. Without it:
 * dev (`NODE_ENV !== "production"`) falls back to permissive `true` so the
 * prototype's local Vite server keeps working with zero config; production
 * fails CLOSED (no origin allowed) rather than the previous `origin: true`,
 * which combined with the pinned pilot identity meant any website could drive
 * the API as the pilot user. See known-issues.md.
 */
export function corsOriginConfig(): true | string[] {
  const explicit = process.env.API_ALLOWED_ORIGINS;
  if (explicit) {
    return explicit
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }
  return process.env.NODE_ENV === "production" ? [] : true;
}

export async function buildServer() {
  const wiring = await buildWiring();
  const createContext = makeContextFactory(wiring);

  const app = Fastify({ logger: true, maxParamLength: 5000 });
  const origin = corsOriginConfig();
  if (origin === true) {
    app.log.warn("CORS: no API_ALLOWED_ORIGINS set — allowing all origins (dev default). Set API_ALLOWED_ORIGINS in any shared/production environment.");
  } else if (origin.length === 0) {
    app.log.warn("CORS: no API_ALLOWED_ORIGINS set and NODE_ENV=production — allowing NO origins. Set API_ALLOWED_ORIGINS to the prototype's real origin(s).");
  }
  await app.register(cors, { origin });

  app.get("/health", async () => ({ ok: true, service: "bridge-api" }));

  // OAuth redirect target (a GET, not tRPC): Google sends the user back here with a
  // `code`. We exchange it for tokens and persist them to the LOCAL plane (never
  // Supabase), then bounce back to the prototype. `state` carries the integration id.
  await registerGoogleOAuthRoutes(app, wiring);

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error }) {
        app.log.error({ path, msg: error.message }, "trpc error");
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
  });

  return app;
}

const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  buildServer()
    .then((app) => app.listen({ port, host: "0.0.0.0" }))
    .then((addr) => console.log(`bridge-api listening at ${addr}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
