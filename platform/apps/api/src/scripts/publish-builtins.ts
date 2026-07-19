/**
 * publish-builtins — POST the curated built-in manifests
 * (built-in-modules.ts) to a running Commons (COMMONS_URL, default local).
 * The built-ins are GENERALIZED capability knowledge (no organization/user data),
 * so they are the honest first real registry content — no seeded dummy data.
 *
 * Usage: pnpm --filter @bridge/api build && pnpm --filter @bridge/api publish-builtins
 * Idempotent-ish: an already-published version reports "skipped (duplicate)".
 */
import { COMMONS_BUILT_IN_MODULES } from "../built-in-modules.js";
import { commonsUrlFromEnv, HttpCommonsClient } from "../commons-client.js";
import { canonicalizeJson, normalizeCommonsTags } from "@bridge/core";

const publishToken = process.env.COMMONS_PUBLISH_TOKEN;
if (!publishToken) {
  throw new Error("COMMONS_PUBLISH_TOKEN is required to publish curated built-ins");
}
const client = new HttpCommonsClient(undefined, { publishToken });

let failures = 0;
for (const { manifest, commons } of COMMONS_BUILT_IN_MODULES) {
  try {
    const { name, version } = await client.publish(manifest, {
      tags: commons.tags,
      provenance: commons.provenance,
    });
    console.log(`published ${name}@${version}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("already published")) {
      const existing = await client.getVersion(manifest.name, manifest.version);
      const matches = existing && canonicalizeJson({
        manifest: existing.manifest,
        tags: normalizeCommonsTags(existing.tags),
        provenance: existing.provenance,
      }) === canonicalizeJson({
        manifest,
        tags: normalizeCommonsTags(commons.tags),
        provenance: commons.provenance,
      });
      if (matches) {
        console.log(`skipped ${manifest.name}@${manifest.version} (identical immutable version)`);
      } else {
        failures += 1;
        console.error(`FAILED ${manifest.name}@${manifest.version}: published version has different immutable content`);
      }
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
