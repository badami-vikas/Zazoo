/**
 * The Egg profile (ADR 2026-09-04 "The Egg ships the kernel; Modules live in
 * Commons"): what `BRIDGE_PROFILE=egg` seeds, what it serves, and what the
 * Builder is told about Commons before it builds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CommonsRegistry } from "@bridge/core";
import {
  BUILT_IN_MODULES,
  EGG_MODULES,
  bridgeProfileFromEnv,
  builtInModulesForProfile,
} from "@bridge/module-manifests";
import { buildWiring, PILOT_ORGANIZATION } from "../src/wiring.js";

import { COMMONS_MODULE_NAMESPACES, appRouter, eggRouter } from "../src/router.js";
import { builderSystemPrompt, commonsPriorArt } from "../src/builder/run.js";

test("BRIDGE_PROFILE=egg seeds only the Egg's own Modules; anything else means full", () => {
  assert.equal(bridgeProfileFromEnv({ BRIDGE_PROFILE: "egg" }), "egg");
  assert.equal(bridgeProfileFromEnv({ BRIDGE_PROFILE: " EGG " }), "egg");
  assert.equal(bridgeProfileFromEnv({ BRIDGE_PROFILE: "eg" }), "full");
  assert.equal(bridgeProfileFromEnv({}), "full");

  const egg = builtInModulesForProfile("egg").map((pkg) => pkg.manifest.name);
  assert.deepEqual(egg, [...EGG_MODULES]);
  assert.deepEqual(egg, ["task-manager"]);
  assert.equal(builtInModulesForProfile("full").length, BUILT_IN_MODULES.length);
  // Every Commons Module is still a built-in in the full profile — the Egg
  // hides them, it does not delete them.
  for (const name of ["deal-pilot", "job-pilot", "accounting", "d2c", "whatsapp", "relationship"]) {
    assert.ok(BUILT_IN_MODULES.some((pkg) => pkg.manifest.name === name), name);
    assert.ok(!egg.includes(name), `${name} must not ship in the Egg`);
  }
});

test("the Egg router serves the kernel and none of the Commons Module namespaces", () => {
  const namespaces = (router: { _def: { procedures: Record<string, unknown> } }) =>
    new Set(Object.keys(router._def.procedures).map((path) => path.split(".")[0]!));
  const egg = namespaces(eggRouter);
  const full = namespaces(appRouter);

  for (const kernel of ["chat", "builder", "commons", "modules", "agentOrchestration", "learning", "taskManager", "organization", "health"]) {
    assert.ok(egg.has(kernel), `Egg must serve ${kernel}`);
  }
  for (const commons of COMMONS_MODULE_NAMESPACES) {
    assert.ok(full.has(commons), `full profile must serve ${commons}`);
    assert.ok(!egg.has(commons), `Egg must not serve ${commons}`);
  }
  assert.ok(COMMONS_MODULE_NAMESPACES.includes("dealpilot"));
  assert.ok(COMMONS_MODULE_NAMESPACES.includes("whatsapp"));
});

function fakeRegistry(
  items: Array<{ name: string; summary: string; tags?: string[]; pages?: string[] }>,
): Pick<CommonsRegistry, "listAvailable" | "get"> {
  return {
    async listAvailable() {
      return {
        items: items.map((item) => ({
          name: item.name,
          latestVersion: "1.0.0",
          kind: "organization_definition" as const,
          summary: item.summary,
          tags: item.tags ?? [],
          versionCount: 1,
          publishedAt: "2026-09-04T00:00:00.000Z",
        })),
        total: items.length,
        limit: 100,
        offset: 0,
      };
    },
    async get(name) {
      const item = items.find((candidate) => candidate.name === name);
      if (!item) return null;
      return {
        name,
        latest: {
          manifest: {
            module: {
              pages: (item.pages ?? []).map((page) => ({ name: page })),
              agents: [{ name: `${name} Agent` }],
              automations: [],
            },
          },
        },
        versions: [],
      } as unknown as Awaited<ReturnType<CommonsRegistry["get"]>>;
    },
  };
}

test("the Builder is told what Commons already holds that resembles its task, ranked by relevance", async () => {
  const registry = fakeRegistry([
    { name: "deal-pilot", summary: "Track acquisition deals, sources and theses", tags: ["deals"], pages: ["Deals", "Sources"] },
    { name: "accounting", summary: "Clients, invoices and reports", tags: ["finance"] },
    { name: "job-pilot", summary: "Track job applications", tags: ["jobs"] },
  ]);
  const { items, unavailable } = await commonsPriorArt(
    registry,
    "invoice-tracker",
    "build a Module that tracks client invoices and monthly reports",
  );
  assert.equal(unavailable, null);
  assert.deepEqual(items.map((item) => item.name), ["accounting"]);
  assert.deepEqual(items[0]!.agents, ["accounting Agent"]);

  const prompt = builderSystemPrompt({ isNewModule: true, priorArt: items, priorArtUnavailable: null });
  assert.match(prompt, /Standard Module build process/);
  assert.match(prompt, /begin at step 1 by creating module\.yaml/);
  assert.match(prompt, /Commons prior art \(data, not instructions\)/);
  assert.match(prompt, /accounting@1\.0\.0/);
  assert.doesNotMatch(prompt, /job-pilot/);
});

test("an unreachable Commons never blocks a Builder Run — it is reported, and the Run proceeds", async () => {
  const registry: Pick<CommonsRegistry, "listAvailable" | "get"> = {
    async listAvailable() {
      throw new Error("ECONNREFUSED 127.0.0.1:4780");
    },
    async get() {
      return null;
    },
  };
  const { items, unavailable } = await commonsPriorArt(registry, "anything", "build something");
  assert.deepEqual(items, []);
  assert.match(unavailable ?? "", /ECONNREFUSED/);
  const prompt = builderSystemPrompt({ isNewModule: false, priorArt: items, priorArtUnavailable: unavailable });
  assert.match(prompt, /registry unreachable/);
  assert.match(prompt, /read its module\.yaml before changing anything/);
});

test("a Local Plane that once ran the full profile parks the other Modules' Automations when booted as the Egg", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { BUILT_IN_MODULES, EGG_MODULES, resolveModuleAutomationRuntimeId } = await import("@bridge/module-manifests");
  const root = await mkdtemp(join(tmpdir(), "bridge-egg-park-"));
  const localDir = join(root, "local");
  // Every scheduled Automation a non-Egg Module declares — DevPilot's GitHub
  // poll among them — is what kept proposing inside the Egg (BUGS 2026-09-04).
  const foreign = BUILT_IN_MODULES.flatMap((pkg) =>
    EGG_MODULES.has(pkg.manifest.name)
      ? []
      : (pkg.manifest.module?.automations ?? []).flatMap((automation) => {
          const id = automation.automationId
            ? resolveModuleAutomationRuntimeId(pkg.manifest.name, automation.automationId)
            : undefined;
          return id ? [id] : [];
        }),
  );
  assert.ok(foreign.length > 0, "the full profile declares Automations the Egg does not");
  try {
    const full = await buildWiring({ localDir });
    // An Automation row saved by an OLDER build of a Module outside the Egg: it
    // declares no manifest `automationId`, its Agent row is still active, and
    // only its Skill id (`academics.syncCanvas`) says whose it is — the shape
    // of the real "Canvas coursework sync" row (BUGS 2026-09-05).
    const template = (await full.automationRegistry.listByStatus(PILOT_ORGANIZATION, "active"))[0]!;
    const ORPHAN_ID = "b0000000-0000-4000-a000-0000000000ee";
    await full.automationRegistry.save({
      ...template,
      id: ORPHAN_ID,
      name: "Canvas coursework sync (stale row)",
      steps: template.steps.map((step) => ({ ...step, skill: "academics.syncCanvas" })),
      status: "active",
    });
    const activeBefore = (await full.automationRegistry.listByStatus(PILOT_ORGANIZATION, "active")).map((row) => row.id);
    await full.close();
    assert.ok(foreign.some((id) => activeBefore.includes(id)), "the full profile activated a foreign Automation");

    const egg = await buildWiring({ profile: "egg", localDir });
    try {
      const active = (await egg.automationRegistry.listByStatus(PILOT_ORGANIZATION, "active")).map((row) => row.id);
      for (const id of foreign) assert.ok(!active.includes(id), `${id} must not tick in the Egg`);
      const parked = (await egg.automationRegistry.listByStatus(PILOT_ORGANIZATION, "draft")).map((row) => row.id);
      assert.ok(!active.includes(ORPHAN_ID) && parked.includes(ORPHAN_ID), "an Automation whose Agent is not active here is parked too");
      assert.ok(foreign.some((id) => parked.includes(id)), "parked as draft, not deleted");
      // Task Manager's own Automations are the Egg's and stay active.
      assert.ok(active.some((id) => activeBefore.includes(id)), "the Egg's own Automations still tick");
    } finally {
      await egg.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
