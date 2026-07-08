/**
 * publish-builtins — POST the four built-in workspace-definition manifests
 * (built-in-packages.ts) to a running Commons (COMMONS_URL, default local).
 * The built-ins are GENERALIZED capability knowledge (no workspace/user data),
 * so they are the honest first real registry content — no seeded dummy data.
 *
 * Usage: pnpm --filter @bridge/api build && pnpm --filter @bridge/api publish-builtins
 * Idempotent-ish: an already-published version reports "skipped (duplicate)".
 */
import { BUILT_IN_PACKAGES } from "../built-in-packages.js";
import { commonsUrlFromEnv, HttpCommonsClient } from "../commons-client.js";

const client = new HttpCommonsClient();

let failures = 0;
for (const { manifest } of BUILT_IN_PACKAGES) {
  try {
    const { name, version } = await client.publish(manifest, ["built-in", manifest.kind]);
    console.log(`published ${name}@${version}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("already published")) {
      console.log(`skipped ${manifest.name}@${manifest.version} (duplicate — already in the registry)`);
    } else {
      failures += 1;
      console.error(`FAILED ${manifest.name}@${manifest.version}: ${message}`);
    }
  }
}

if (failures > 0) {
  console.error(`publish-builtins: ${failures} failure(s) against ${commonsUrlFromEnv()}`);
  process.exit(1);
}
