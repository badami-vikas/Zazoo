import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const blueprint = await readFile(new URL("../../render.yaml", import.meta.url), "utf8");
const turboConfig = JSON.parse(
  await readFile(new URL("../turbo.json", import.meta.url), "utf8"),
);

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
  assert.match(blueprint, /healthCheckPath: \/health/);
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
  assert.deepEqual(turboConfig.tasks.build.env, [
    "VITE_API_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_URL",
  ]);
  assert.doesNotMatch(blueprint, /\ndatabases:/);
  assert.doesNotMatch(blueprint, /\ndisk:/);
  assert.doesNotMatch(blueprint, /encrypted-host-volume/);
  assert.doesNotMatch(blueprint, /BRIDGE_CREDENTIAL_VAULT_KEY/);
  assert.doesNotMatch(blueprint, /service_role|postgresql:\/\//);
  assert.match(blueprint, /previews:\s*\n\s*generation: "off"/);
});

test("the AI Harness pilot flights hold their DELIBERATE hosted state", () => {
  // Drift in either direction is the defect: a dropped "1" silently turns the
  // harness off for the hosted pilot with no error anywhere (each learning.*
  // procedure just fails closed), and a quietly re-enabled "0" would turn a
  // deliberately-disabled surface back on. Same defect class the desktop
  // sidecar's flights test guards against. COMMONS_ARCHETYPES is "0" per
  // TASK-034(d) (14d44d2): disabled in production until Commons is deployed.
  for (const [flight, value] of [
    ["BRIDGE_LEARNING_OBSERVATION", "1"],
    ["BRIDGE_RETRIEVAL_FUSION", "1"],
    ["BRIDGE_COMMONS_ARCHETYPES", "0"],
    ["BRIDGE_CLAIM_SUBSTRATE", "1"],
  ]) {
    assert.match(
      blueprint,
      new RegExp(`${flight}\\s*\\n\\s*value: "${value}"`),
      `${flight} must be pinned to "${value}" for the hosted pilot (AI Harness K0/K3; TASK-034(d))`,
    );
  }
});
