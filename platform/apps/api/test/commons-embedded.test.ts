/**
 * The API hosts the local-first Commons registry, and seeds it once.
 *
 * The bug these pin: `commonsRegistry` pointed at localhost:4780 and nothing
 * ever started a service there, so "install DealPilot" met a refused
 * connection and the Commons catalog was permanently empty. The interesting
 * assertions are therefore about WHEN we host (never over the top of a
 * configured remote registry) and that seeding happens exactly once.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  embeddedCommonsDataDir,
  shouldHostEmbeddedCommons,
  startEmbeddedCommons,
} from "../src/commons-embedded.js";

const PUBLIC_CLOUD = { BRIDGE_LOCAL_RESIDENCY: "public-cloud" } as NodeJS.ProcessEnv;

test("a public-cloud deployment never hosts its own registry", () => {
  const decision = shouldHostEmbeddedCommons(PUBLIC_CLOUD);
  assert.equal(decision.host, false);
});

test("a COMMONS_URL pointing off this machine is left alone", () => {
  // Hosting a local registry while a real one is configured would silently
  // shadow it — the client would talk to us and never reach the real catalog.
  const decision = shouldHostEmbeddedCommons({
    COMMONS_URL: "https://commons.bridge.example",
  } as NodeJS.ProcessEnv);
  assert.equal(decision.host, false);
  assert.match((decision as { reason: string }).reason, /not this machine/);
});

test("loopback is hosted, on the port the URL names", () => {
  const decision = shouldHostEmbeddedCommons({
    COMMONS_URL: "http://127.0.0.1:4899",
  } as NodeJS.ProcessEnv);
  assert.equal(decision.host, true);
  assert.equal((decision as { port: number }).port, 4899);
});

test("the store sits beside the Local Plane when one is configured", () => {
  assert.equal(
    embeddedCommonsDataDir({ BRIDGE_LOCAL_DIR: "/var/bridge" } as NodeJS.ProcessEnv),
    join("/var/bridge", "commons"),
  );
  // An explicit data dir always wins over the derived one.
  assert.equal(
    embeddedCommonsDataDir({
      BRIDGE_LOCAL_DIR: "/var/bridge",
      COMMONS_DATA_DIR: "/elsewhere",
    } as NodeJS.ProcessEnv),
    "/elsewhere",
  );
});

test("an empty registry is seeded with the curated Modules, and only once", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "commons-embedded-"));
  // Port 0, not a fixed one. A hard-coded port made this test fail whenever
  // anything else on the machine held it — including a second copy of this
  // very suite — which is a property of the harness, not of the code.
  const env = {
    COMMONS_DATA_DIR: dataDir,
    COMMONS_URL: "http://127.0.0.1:0",
  } as NodeJS.ProcessEnv;
  const firstLog: string[] = [];
  const first = await startEmbeddedCommons(env, (message) => firstLog.push(message));
  try {
    // Carry the reason into the assertion: `startEmbeddedCommons` returns null
    // for every refusal, so without this a failure here says only "not true".
    assert.ok(first, `should host on a free loopback port — ${firstLog.join(" | ")}`);
    assert.ok(first.seeded > 0, "an empty registry gets the curated built-ins");
    const listed = await fetch(`${first.url}/v1/modules?limit=50`).then((r) => r.json()) as {
      total: number;
      items: { name: string }[];
    };
    assert.equal(listed.total, first.seeded);
    // The Module the user could not install is in the catalog.
    assert.ok(listed.items.some((item) => item.name === "deal-pilot"));
    // The publish token is a real secret, persisted — not a fixed default.
    const token = JSON.parse(readFileSync(join(dataDir, "publish-token.json"), "utf8")) as {
      publishToken: string;
    };
    assert.ok(token.publishToken.length >= 32);
  } finally {
    await first?.close();
  }

  // Second boot over the SAME store. `seeded === 0` alone does not prove the
  // emptiness guard works — without it every publish would be REFUSED as a
  // duplicate and the count would still come back 0. What separates the two is
  // whether we tried at all, so assert on the noise: ten failed round trips and
  // ten "could not publish" lines on every boot is the thing being prevented.
  const lines: string[] = [];
  const second = await startEmbeddedCommons(env, (message) => lines.push(message));
  try {
    assert.ok(second);
    assert.equal(second.seeded, 0, "a populated registry is left exactly as it is");
    assert.deepEqual(
      lines.filter((line) => line.includes("could not publish")),
      [],
      "a populated registry is not re-published against",
    );
  } finally {
    await second?.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
