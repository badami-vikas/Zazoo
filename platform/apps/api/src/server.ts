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
import { registerReconIntakeRoute } from "./intake/recon-route.js";

export async function buildServer() {
  const wiring = await buildWiring();
  const createContext = makeContextFactory(wiring);

  const app = Fastify({ logger: true, maxParamLength: 5000 });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true, service: "bridge-api" }));

  // OAuth redirect target (a GET, not tRPC): Google sends the user back here with a
  // `code`. We exchange it for tokens and persist them to the LOCAL plane (never
  // Supabase), then bounce back to the prototype. `state` carries the integration id.
  await registerGoogleOAuthRoutes(app, wiring);

  // POST /intake/recon — Recon posts its CaptureEnvelope as raw JSON (not tRPC); maps to
  // governed propose-requests so findings land as pending_review ledger rows.
  registerReconIntakeRoute(app, wiring);

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
