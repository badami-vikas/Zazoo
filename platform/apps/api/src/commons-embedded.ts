/**
 * commons-embedded.ts — run the local-first Commons registry inside the API
 * process, and seed it with the curated built-ins on first boot.
 *
 * WHY THIS EXISTS. Every piece of Commons install worked except the part that
 * makes it reachable: `commonsRegistry` is an `HttpCommonsClient` pointed at
 * `http://localhost:4780`, and nothing — not the dev scripts, not the desktop
 * sidecar — ever started the service behind it. A person asking to install a
 * Module that IS in Commons got a connection refused, or, through Chat, an
 * offer to hand-build a Module they already owned. A registry nobody starts is
 * a registry with nothing in it.
 *
 * WHY IN-PROCESS RATHER THAN A SECOND SIDECAR. The service is a Fastify app
 * behind an exported factory, so hosting it costs a listen call, and the thing
 * that makes Commons trustworthy is unchanged: entries are still Ed25519-signed
 * at publish and verified at install by the same client over the same HTTP
 * contract. Nothing here bypasses that seam — the API talks to this registry
 * exactly as it would talk to Bridge Cloud. What we avoid is a second process
 * to supervise, and a desktop install where the registry silently isn't up.
 *
 * WHEN IT DOES NOT RUN. Public-cloud residency, or any `COMMONS_URL` that is
 * not loopback: both mean a real registry is configured elsewhere and hosting a
 * second one locally would quietly shadow it. A port already in use means
 * someone started `services/commons` themselves, which is theirs to own.
 *
 * ponytail: the whole curated set is published on the first empty boot. It is
 * ten manifests; if the catalog ever grows enough for that to be felt, publish
 * lazily on first browse.
 */
import { buildCommonsServer, FsCommonsStore, resolveCommonsPublishToken, resolveCommonsSigningKeyPair } from "@bridge/commons";
import { COMMONS_BUILT_IN_MODULES } from "@bridge/module-manifests";
import { parseModuleManifest } from "@bridge/core";
import { join } from "node:path";
import { commonsUrlFromEnv, HttpCommonsClient } from "./commons-client.js";
import { isPublicCloudOnly } from "./deployment-boundary.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Where the registry's JSON store, signing key and publish token live. */
export function embeddedCommonsDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COMMONS_DATA_DIR) return env.COMMONS_DATA_DIR;
  // Beside the rest of the Local Plane when the operator named one, so a
  // registry does not end up in whatever directory the process started in.
  return env.BRIDGE_LOCAL_DIR ? join(env.BRIDGE_LOCAL_DIR, "commons") : ".commons-data";
}

/**
 * Should this process host the registry? Split out from `startEmbeddedCommons`
 * so the decision is testable without binding a port.
 */
export function shouldHostEmbeddedCommons(
  env: NodeJS.ProcessEnv = process.env,
): { host: false; reason: string } | { host: true; port: number; hostname: string } {
  if (isPublicCloudOnly(env)) {
    return { host: false, reason: "public-cloud residency uses the hosted registry" };
  }
  let url: URL;
  try {
    url = new URL(commonsUrlFromEnv(env));
  } catch {
    return { host: false, reason: "COMMONS_URL is not a valid URL" };
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return { host: false, reason: `COMMONS_URL points at ${url.hostname}, not this machine` };
  }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  return { host: true, port, hostname: "127.0.0.1" };
}

export interface EmbeddedCommons {
  close: () => Promise<void>;
  /** How many curated Modules this boot published (0 when already seeded). */
  seeded: number;
  /** Where it actually ended up serving. Not always the port that was asked
   * for: a `COMMONS_URL` port of 0 binds an ephemeral one, which is how a test
   * avoids racing a fixed port against anything else on the machine. */
  url: string;
}

/**
 * Start the registry and seed it if empty. Never throws: a Commons that failed
 * to come up must not stop the API from serving everything else — the browse
 * and install surfaces report the failure honestly on their own.
 */
export async function startEmbeddedCommons(
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = console.log,
): Promise<EmbeddedCommons | null> {
  const decision = shouldHostEmbeddedCommons(env);
  if (!decision.host) {
    log(`commons: not hosting locally — ${decision.reason}`);
    return null;
  }
  const dataDir = embeddedCommonsDataDir(env);
  let app: ReturnType<typeof buildCommonsServer>;
  try {
    const keyPair = resolveCommonsSigningKeyPair(env, join(dataDir, "signing-key.json"));
    const publishToken = resolveCommonsPublishToken(env, join(dataDir, "publish-token.json"));
    app = buildCommonsServer(new FsCommonsStore(dataDir), { keyPair, publishToken });
    // The listen ADDRESS, not the requested port: with port 0 the two differ,
    // and seeding must talk to where the server actually is.
    const address = await app.listen({ port: decision.port, host: decision.hostname });
    const seeded = await seedCommonsBuiltins(address, publishToken, log);
    log(`commons: hosting registry at ${address} (${dataDir})`);
    return { close: async () => { await app.close(); }, seeded, url: address };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      // Someone is already serving it — theirs to own, and the client will
      // reach it at the same URL either way.
      log(`commons: port ${decision.port} already serving a registry; using it`);
      return null;
    }
    log(`commons: could not host a local registry (${String(error)})`);
    return null;
  }
}

/**
 * Publish the curated built-ins, but only into an EMPTY registry.
 *
 * Emptiness is the guard on purpose. Published versions are immutable, so
 * re-publishing an existing one is an error rather than a no-op, and a
 * registry with content in it has a history — someone's own published Module,
 * a version pinned deliberately — that a boot has no business reconciling.
 * Republishing after a curated manifest changes is `publish-builtins`' job.
 */
async function seedCommonsBuiltins(
  baseUrl: string,
  publishToken: string,
  log: (message: string) => void,
): Promise<number> {
  const client = new HttpCommonsClient(baseUrl, { publishToken });
  const existing = await client.listAvailable({ limit: 1, offset: 0 });
  if (existing.total > 0) return 0;
  let published = 0;
  for (const { manifest: sourceManifest, commons } of COMMONS_BUILT_IN_MODULES) {
    try {
      await client.publish(parseModuleManifest({ module: sourceManifest }), {
        tags: commons.tags,
        provenance: commons.provenance,
      });
      published += 1;
    } catch (error) {
      // One bad manifest must not cost the other nine their place in the
      // catalog — the Module simply is not offered, which is honest.
      log(`commons: could not publish ${sourceManifest.name}: ${String(error)}`);
    }
  }
  if (published > 0) log(`commons: published ${published} curated Modules into an empty registry`);
  return published;
}
