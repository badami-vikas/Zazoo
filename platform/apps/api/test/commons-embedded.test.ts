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
import { COMMONS_BUILT_IN_MODULES } from "@bridge/module-manifests";

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

test("a registry is seeded with the curated Modules it lacks, and nothing is republished", async () => {
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
    // NOT `COMMONS_BUILT_IN_MODULES.length`: `relationship` and `devpilot` are
    // refused by the publish scan because their capability union is the lethal
    // trifecta, so the registry holds 13 of 15 and neither ever reaches the New
    // dialog (BUGS OPEN 2026-09-11, user report repeated 2026-09-15). Pin the
    // real number so the day that decision is taken, this test says so.
    const refused = firstLog.filter((line) => line.includes("could not publish"));
    assert.equal(refused.length, 2, `only the two trifecta built-ins are refused — ${refused.join(" | ")}`);
    assert.equal(first.seeded, COMMONS_BUILT_IN_MODULES.length - 2);
    const listed = await fetch(`${first.url}/v1/modules?limit=50`).then((r) => r.json()) as {
      total: number;
      items: { name: string }[];
    };
    assert.equal(listed.total, first.seeded);
    const offered = new Set(listed.items.map((item) => item.name));
    assert.ok(offered.has("deal-pilot"));
    // The two the publish scan used to refuse outright, so they reached no
    // surface at all: their capability union IS the lethal trifecta, and as
    // first-party built-ins they are published with that verdict recorded
    // rather than withheld (user report 2026-09-11, repeated 2026-09-15).
    // `modules.install` still halts them for the owner's approval.
    assert.ok(!offered.has("relationship"), "Relationship is withheld by the trifecta gate — the open defect");
    assert.ok(!offered.has("devpilot"), "DevPilot is withheld by the trifecta gate — the open defect");
    // The publish token is a real secret, persisted — not a fixed default.
    const token = JSON.parse(readFileSync(join(dataDir, "publish-token.json"), "utf8")) as {
      publishToken: string;
    };
    assert.ok(token.publishToken.length >= 32);
  } finally {
    await first?.close();
  }

  // Second boot over the SAME store, with one built-in removed from it — the
  // shape of a registry seeded before that Module was curated (the 2026-09-11
  // "I still dont see all module options" report). Exactly the missing one is
  // published; the rest are not tried. `seeded` alone would not prove that —
  // without the presence check every publish would be REFUSED as a duplicate
  // and the count would still come back right — so assert on the noise too.
  rmSync(join(dataDir, "modules", "deal-pilot"), { recursive: true, force: true });
  const lines: string[] = [];
  const second = await startEmbeddedCommons(env, (message) => lines.push(message));
  try {
    assert.ok(second);
    assert.equal(second.seeded, 1, "only the built-in the registry lacks is published");
    const relisted = await fetch(`${second.url}/v1/modules?limit=50`).then((r) => r.json()) as {
      items: { name: string }[];
    };
    assert.ok(relisted.items.some((item) => item.name === "deal-pilot"), "the missing Module is offered again");
    // Only the two the scan refuses may appear here; anything the registry
    // already holds must not be tried at all.
    const held = new Set(relisted.items.map((item) => item.name));
    for (const line of lines.filter((l) => l.includes("could not publish"))) {
      const name = /could not publish ([^:]+):/.exec(line)?.[1];
      assert.ok(name && !held.has(name), `re-published against a held Module: ${line}`);
    }
  } finally {
    await second?.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
