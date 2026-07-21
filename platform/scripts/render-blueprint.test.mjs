import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const blueprint = await readFile(new URL("../../render.yaml", import.meta.url), "utf8");

test("Render Blueprint stays free-only and carries no cloud Local Plane", () => {
  assert.match(blueprint, /name: bridge-pilot-api/);
  assert.equal(
    blueprint.match(/repo: https:\/\/github\.com\/badami-vikas\/relationship-os/g)?.length,
    2,
  );
  assert.match(blueprint, /runtime: docker/);
  assert.match(blueprint, /plan: free/);
  assert.match(blueprint, /region: virginia/);
  assert.match(blueprint, /dockerfilePath: \.\/platform\/Dockerfile/);
  assert.match(blueprint, /dockerContext: \.\/platform/);
  assert.match(blueprint, /healthCheckPath: \/health\/ready/);
  assert.match(blueprint, /name: bridge-pilot-web/);
  assert.match(blueprint, /runtime: static/);
  assert.match(blueprint, /staticPublishPath: platform\/apps\/web\/dist/);
  assert.match(blueprint, /turbo run build --filter=\.\.\.@bridge\/web/);
  assert.match(
    blueprint,
    /BRIDGE_RENDER_WEB_HOST\s*\n\s*value: bridge-pilot-web\.onrender\.com/,
  );
  assert.match(
    blueprint,
    /BRIDGE_RENDER_API_HOST\s*\n\s*value: bridge-pilot-api\.onrender\.com/,
  );
  assert.doesNotMatch(blueprint, /property: host/);
  assert.match(blueprint, /BRIDGE_LOCAL_RESIDENCY\s*\n\s*value: public-cloud/);
  assert.match(
    blueprint,
    /BRIDGE_DEALPILOT_CREDENTIAL_VAULT\s*\n\s*value: disabled/,
  );
  assert.match(blueprint, /DATABASE_URL\s*\n\s*sync: false/);
  assert.match(blueprint, /BRIDGE_PILOT_USER_ID\s*\n\s*sync: false/);
  assert.match(blueprint, /VITE_SUPABASE_PUBLISHABLE_KEY\s*\n\s*sync: false/);
  assert.doesNotMatch(blueprint, /\ndatabases:/);
  assert.doesNotMatch(blueprint, /\ndisk:/);
  assert.doesNotMatch(blueprint, /encrypted-host-volume/);
  assert.doesNotMatch(blueprint, /BRIDGE_CREDENTIAL_VAULT_KEY/);
  assert.doesNotMatch(blueprint, /service_role|postgresql:\/\//);
  assert.match(blueprint, /previews:\s*\n\s*generation: "off"/);
});
