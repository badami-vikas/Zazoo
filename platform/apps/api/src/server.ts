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

export async function buildServer() {
  const wiring = buildWiring();
  const createContext = makeContextFactory(wiring);

  const app = Fastify({ logger: true, maxParamLength: 5000 });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true, service: "bridge-api" }));

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
