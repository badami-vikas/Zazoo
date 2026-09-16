/**
 * Local-first Commons entrypoint. COMMONS_DATA_DIR picks the JSON store root
 * (default .commons-data/, gitignored); COMMONS_PORT the port (default 4780).
 */
import { buildCommonsServer } from "./server.js";
import { resolveCommonsPublishToken, resolveCommonsSigningKeyPair } from "./signing.js";
import { FsCommonsStore } from "./store.js";
import { join } from "node:path";

const dataDir = process.env.COMMONS_DATA_DIR ?? ".commons-data";
const port = Number(process.env.COMMONS_PORT ?? 4780);
const host = process.env.COMMONS_HOST ?? "127.0.0.1";
// Persisted beside the signing key rather than demanded from the environment:
// a local-first registry nobody can start is a registry nothing can install
// from. `COMMONS_PUBLISH_TOKEN` still wins, and a shared registry must set it.
const publishToken = resolveCommonsPublishToken(process.env, join(dataDir, "publish-token.json"));

const keyPair = resolveCommonsSigningKeyPair(process.env, join(dataDir, "signing-key.json"));
const app = buildCommonsServer(new FsCommonsStore(dataDir), { keyPair, publishToken });

app
  .listen({ port, host })
  .then((address) => {
    app.log.info(`Universal Commons (local-first) on ${address}, data dir: ${dataDir}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
