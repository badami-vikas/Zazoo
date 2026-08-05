/**
 * Capability archetypes over the real HTTP contract (fastify inject) backed
 * by the real FsCommonsStore — publish → list roundtrip, deterministic-name
 * dedupe across "workspaces", privacy-gate rejection, auth, and signature.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archetypeName } from "@bridge/core";
import { buildCommonsServer } from "../src/server.js";
import { FsCommonsStore } from "../src/store.js";

const TEST_PUBLISH_TOKEN = "test-commons-publisher-token-00000001";
const AUTH_HEADERS = { authorization: `Bearer ${TEST_PUBLISH_TOKEN}` };

function archetype(action = "dismiss", key = "industry", value = "restaurants", domain = "dealpilot") {
  return {
    schemaVersion: 1,
    name: archetypeName(domain, { action, attributeKey: key, attributeValue: value }),
    domain,
    kind: "preference_pattern",
    action,
    attributeKey: key,
    attributeValue: value,
    supportBand: "3-5",
  };
}

test("archetype publish → list roundtrip, dedupe, privacy gate, auth", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "commons-archetype-test-"));
  const app = buildCommonsServer(new FsCommonsStore(dataDir), { publishToken: TEST_PUBLISH_TOKEN });
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  // Unauthorized publish is refused.
  const unauthorized = await app.inject({ method: "POST", url: "/v1/archetypes", payload: { archetype: archetype() } });
  assert.equal(unauthorized.statusCode, 401);

  // First publish signs and stores.
  const first = await app.inject({
    method: "POST",
    url: "/v1/archetypes",
    headers: AUTH_HEADERS,
    payload: { archetype: archetype(), tags: ["acquisition-search"] },
  });
  assert.equal(first.statusCode, 201);
  const firstBody = first.json() as { name: string; contentHash: string };
  assert.equal(firstBody.name, "preference.dealpilot.dismiss.industry.restaurants");
  assert.match(firstBody.contentHash, /^sha256:[0-9a-f]{64}$/);

  // A second organization publishing the SAME pattern aggregates: the entry
  // is superseded by a freshly signed revision with contributions 2 and the
  // max support band seen.
  const second = await app.inject({
    method: "POST",
    url: "/v1/archetypes",
    headers: AUTH_HEADERS,
    payload: { archetype: { ...archetype(), supportBand: "6-10" }, tags: ["deal-flow"] },
  });
  assert.equal(second.statusCode, 200);
  const secondBody = second.json() as {
    aggregated?: boolean;
    contributions?: number;
    supportBand?: string;
    contentHash: string;
  };
  assert.equal(secondBody.aggregated, true);
  assert.equal(secondBody.contributions, 2);
  assert.equal(secondBody.supportBand, "6-10");
  assert.notEqual(secondBody.contentHash, firstBody.contentHash);

  // A third weaker contribution keeps the max band, bumps the count, and
  // unions tags — and the served revision still signature-verifies.
  const third = await app.inject({
    method: "POST",
    url: "/v1/archetypes",
    headers: AUTH_HEADERS,
    payload: { archetype: archetype() },
  });
  assert.equal(third.statusCode, 200);
  const thirdBody = third.json() as { contributions?: number; supportBand?: string };
  assert.equal(thirdBody.contributions, 3);
  assert.equal(thirdBody.supportBand, "6-10");

  // Privacy gate: a personal-shaped attribute value is rejected with paths.
  const leaky = await app.inject({
    method: "POST",
    url: "/v1/archetypes",
    headers: AUTH_HEADERS,
    payload: { archetype: archetype("dismiss", "seller", "owner@example.com") },
  });
  assert.equal(leaky.statusCode, 422);
  assert.ok((leaky.json() as { offendingPaths: string[] }).offendingPaths.length > 0);

  // A name that is not the deterministic slug of its own pattern is refused.
  const misnamed = await app.inject({
    method: "POST",
    url: "/v1/archetypes",
    headers: AUTH_HEADERS,
    payload: { archetype: { ...archetype("pursue", "geo", "texas"), name: "preference.dealpilot.someone.elses.name" } },
  });
  assert.equal(misnamed.statusCode, 400);

  // Second distinct pattern for another domain, then list filters by domain.
  const other = await app.inject({
    method: "POST",
    url: "/v1/archetypes",
    headers: AUTH_HEADERS,
    payload: { archetype: archetype("pursue", "seniority", "staff", "jobpilot") },
  });
  assert.equal(other.statusCode, 201);

  const all = await app.inject({ method: "GET", url: "/v1/archetypes" });
  assert.equal((all.json() as { total: number }).total, 2);
  const dealOnly = await app.inject({ method: "GET", url: "/v1/archetypes?domain=dealpilot" });
  const dealBody = dealOnly.json() as {
    total: number;
    archetypes: Array<{
      archetype: { domain: string; supportBand: string };
      contributions: number;
      tags: string[];
      signature?: { algorithm: string };
    }>;
  };
  assert.equal(dealBody.total, 1);
  assert.equal(dealBody.archetypes[0]!.archetype.domain, "dealpilot");
  // The served entry is the aggregated revision: count 3, max band, tag union.
  assert.equal(dealBody.archetypes[0]!.contributions, 3);
  assert.equal(dealBody.archetypes[0]!.archetype.supportBand, "6-10");
  assert.deepEqual(dealBody.archetypes[0]!.tags, ["acquisition-search", "deal-flow"]);
  // Every served entry carries the registry's ed25519 signature.
  assert.equal(dealBody.archetypes[0]!.signature?.algorithm, "ed25519");
});
