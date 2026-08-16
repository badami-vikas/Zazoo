import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILT_IN_MODULES,
  COMMONS_BUILT_IN_MODULES,
  moduleNavTarget,
  requireBuiltInModule,
} from "../src/index.js";
import { canonicalizeManifest, parseModuleManifest, TASK_PLAYBOOKS } from "@bridge/core";

test("built-in Module catalog has one manifest per Module name", () => {
  const names = BUILT_IN_MODULES.map(({ manifest }) => manifest.name);
  assert.deepEqual(names, [
    "deal-pilot",
    "job-pilot",
    "relationship",
    "helpdesk",
    "academics",
    "events",
    "whatsapp",
    "task-manager",
    "devpilot",
    // Imported Modules (ADR-246). D2C's Orders/Inventory are toggle Pages of
    // the parent, not sub-modules; Research and Notes nest below it.
    "accounting",
    "d2c",
    "d2c-research",
    "d2c-notes",
  ]);
  assert.equal(new Set(names).size, names.length);
});

test("Helpdesk is a NetworkManager sub-module, and stays out of Commons", () => {
  const helpdesk = requireBuiltInModule("helpdesk").manifest;
  // The nav parent is what makes it appear indented under NetworkManager. Its
  // absence is exactly why the Page was reachable by URL but invisible.
  assert.equal(helpdesk.module?.parentModule, "relationship");
  assert.equal(helpdesk.module?.route, "/module/relationship/helpdesk");
  // Reuses the parent's already-declared sub-module capability rather than
  // minting a second grant over the same private Records.
  assert.deepEqual(
    helpdesk.module?.pages.map((page) => page.capabilityId),
    ["relationship.submodule.helpdesk"],
  );
  // Commons never carries personal data, and Help items are the owner's own.
  assert.equal(
    COMMONS_BUILT_IN_MODULES.some((pkg) => pkg.manifest.name === "helpdesk"),
    false,
  );
});

test("Task Manager is a signed installable Module with one Task Database and Agent-owned Skills", () => {
  const taskManager = requireBuiltInModule("task-manager").manifest;
  assert.equal(taskManager.module?.route, "/task-manager");
  assert.deepEqual(taskManager.module?.pages.map((page) => page.databaseId), ["task-manager.tasks"]);
  assert.equal(taskManager.module?.agents.length, 5);
  assert.ok(taskManager.module?.agents.find((agent) => agent.id === "chief-of-staff")?.skillIds.includes("task-manager.skill.agent-task-routing"));
  assert.ok(taskManager.module?.automations.every((automation) => Boolean(automation.agentId)));
  const normalized = parseModuleManifest({ module: taskManager });
  assert.equal(
    canonicalizeManifest(parseModuleManifest({ module: normalized })),
    canonicalizeManifest(normalized),
  );
  assert.deepEqual(normalized.module?.commonsNeeds, []);
});

test("Relationship exposes governed web research only through the Learning Agent", () => {
  const relationship = requireBuiltInModule("relationship").manifest;
  const webResearch = relationship.capabilities.find(
    (capability) => capability.id === "web-research",
  );
  assert.equal(webResearch?.capabilityType, "skill");
  assert.ok(
    webResearch?.permissions.some(
      (permission) =>
        permission.resourceType === "external:fetch" &&
        permission.action === "read" &&
        permission.dataScope === "public" &&
        permission.egress,
    ),
  );
  const consumers = relationship.module?.agents.filter((agent) =>
    agent.skillIds.includes("web-research"),
  );
  assert.deepEqual(consumers?.map((agent) => agent.id), ["learning-agent"]);
});

test("moduleNavTarget lands each Module on its primary data Page with a highlight base", () => {
  // Landing = the first Page's route (the buttons-at-top data section), NOT the
  // /module/:name capability inventory. Base = shared Page-route prefix so every
  // sibling Page highlights the same rail entry.
  assert.deepEqual(moduleNavTarget("deal-pilot"), {
    landing: "/dealpilot/deals",
    base: "/dealpilot",
  });
  assert.deepEqual(moduleNavTarget("relationship"), {
    landing: "/module/relationship/signals",
    base: "/module/relationship",
  });
  // Single-Page Modules land on (and highlight from) that one route.
  assert.deepEqual(moduleNavTarget("job-pilot"), { landing: "/jobpilot", base: "/jobpilot" });
  assert.deepEqual(moduleNavTarget("task-manager"), {
    landing: "/task-manager",
    base: "/task-manager",
  });
  // Landing is never the capability-inventory overview.
  for (const { manifest } of BUILT_IN_MODULES) {
    const nav = moduleNavTarget(manifest.name);
    assert.ok(nav);
    assert.notEqual(nav.landing, `/module/${manifest.name}`);
    assert.ok(nav.landing.startsWith(nav.base));
  }
  // Unknown / non-data Modules fall back (caller uses /module/:name instead).
  assert.equal(moduleNavTarget("interview-calendar-availability"), undefined);
  assert.equal(moduleNavTarget("does-not-exist"), undefined);
});

test("every built-in Module route is declared by its manifest", () => {
  for (const { manifest } of BUILT_IN_MODULES) {
    assert.ok(manifest.module);
    assert.ok(manifest.module.route.startsWith("/"));
    for (const page of manifest.module.pages) {
      assert.ok(page.route.startsWith(`${manifest.module.route.split("/").slice(0, -1).join("/")}/`));
    }
    assert.equal(requireBuiltInModule(manifest.name).manifest, manifest);
  }
});

test("WhatsApp is an installable Module with Chats and Tools Pages", () => {
  const whatsapp = requireBuiltInModule("whatsapp").manifest;
  assert.equal(whatsapp.module?.displayName, "WhatsApp");
  assert.deepEqual(whatsapp.module?.pages.map((page) => page.id), ["chats", "tools"]);
  assert.deepEqual(moduleNavTarget("whatsapp"), {
    landing: "/module/whatsapp/chats",
    base: "/module/whatsapp",
  });
  const normalized = parseModuleManifest({ module: whatsapp });
  assert.equal(
    canonicalizeManifest(parseModuleManifest({ module: normalized })),
    canonicalizeManifest(normalized),
  );
});

test("WhatsApp v1 declares no egress and no Automation", () => {
  const whatsapp = requireBuiltInModule("whatsapp").manifest;
  // v1 is read-only over the owner's own session. An egress permission here
  // would mean the manifest had drifted from the desktop op allowlist.
  for (const capability of whatsapp.capabilities) {
    for (const permission of capability.permissions) {
      assert.equal(permission.egress, false, `${capability.id} declares egress`);
      assert.equal(permission.dataScope, "private", `${capability.id} is not private-scoped`);
    }
  }
  // No Automation may run a WhatsApp read — every extraction is user-clicked.
  assert.deepEqual(whatsapp.module?.automations, []);
});

test("WhatsApp is withheld from Commons", () => {
  const published = COMMONS_BUILT_IN_MODULES.map(({ manifest }) => manifest.name);
  assert.ok(!published.includes("whatsapp"));
  assert.ok(!published.includes("relationship"));
});

test("DevPilot is an installable Module with Pull Requests, Issues, and Repos Pages", () => {
  const devpilot = requireBuiltInModule("devpilot").manifest;
  assert.equal(devpilot.module?.displayName, "DevPilot");
  assert.deepEqual(devpilot.module?.pages.map((page) => page.id), ["pulls", "issues", "repos"]);
  assert.deepEqual(moduleNavTarget("devpilot"), {
    landing: "/module/devpilot/pulls",
    base: "/module/devpilot",
  });
  const normalized = parseModuleManifest({ module: devpilot });
  assert.equal(
    canonicalizeManifest(parseModuleManifest({ module: normalized })),
    canonicalizeManifest(normalized),
  );
});

test("DevPilot declares no external:send capability — draft-only through D2, posting is a future capability", () => {
  const devpilot = requireBuiltInModule("devpilot").manifest;
  for (const capability of devpilot.capabilities) {
    for (const permission of capability.permissions) {
      assert.notEqual(
        permission.resourceType,
        "external:send",
        `${capability.id} must not declare external:send in D1`,
      );
    }
  }
});

test("DevPilot's Agents each have a Plane and the poll Automation has a machine-readable schedule", () => {
  const devpilot = requireBuiltInModule("devpilot").manifest;
  assert.equal(devpilot.module?.agents.length, 2);
  for (const agent of devpilot.module?.agents ?? []) {
    assert.equal(agent.plane, "cloud");
  }
  const poll = devpilot.module?.automations[0];
  assert.ok(poll);
  assert.equal(poll.schedule?.kind, "schedule");
  assert.ok(poll.automationId, "the poll Automation must opt into the executable runtime");
});

test("DevPilot D2's engineering-assist Automations are manual (no schedule) but opt into the executable runtime", () => {
  const devpilot = requireBuiltInModule("devpilot").manifest;
  const manual = (devpilot.module?.automations ?? []).filter((automation) => automation.id !== "github-poll");
  assert.equal(manual.length, 3);
  for (const automation of manual) {
    assert.equal(automation.schedule, undefined, `${automation.id} is Human-triggered, not scheduled`);
    assert.ok(automation.automationId, `${automation.id} must opt into the executable runtime`);
    assert.equal(automation.agentId, "reviewer-agent");
  }
});

test("DevPilot is withheld from Commons", () => {
  const published = COMMONS_BUILT_IN_MODULES.map(({ manifest }) => manifest.name);
  assert.ok(!published.includes("devpilot"));
});

// ---------------------------------------------------------------------
// TM6 (ADR-206) — Commons packaging. The plan's exit criterion is that a
// fresh Organization installs Task Manager from Commons "with no personal
// data crossing to Commons (audited)". This is that audit.
// ---------------------------------------------------------------------

test("Task Manager ships its Playbooks in the manifest, derived from their content", () => {
  const taskManager = BUILT_IN_MODULES.find((candidate) => candidate.manifest.name === "task-manager");
  assert.ok(taskManager);
  const playbooks = taskManager.manifest.module?.playbooks ?? [];
  assert.equal(
    playbooks.length,
    TASK_PLAYBOOKS.length,
    "roster and content cannot drift — the manifest is derived from TASK_PLAYBOOKS",
  );
  assert.deepEqual(
    playbooks.map((playbook) => playbook.id).sort(),
    TASK_PLAYBOOKS.map((playbook) => playbook.id).sort(),
  );
  // Every Playbook may only name Skills this Module actually declares,
  // otherwise a fresh install runs a methodology whose Skills never arrived.
  const declaredSkills = new Set(
    taskManager.manifest.capabilities
      .filter((capability) => capability.capabilityType === "skill")
      .map((capability) => capability.id),
  );
  for (const playbook of playbooks) {
    assert.ok(playbook.skillCapabilityIds.length > 0, `${playbook.id} must be able to run something`);
    for (const skillId of playbook.skillCapabilityIds) {
      assert.ok(declaredSkills.has(skillId), `${playbook.id} names an undeclared Skill: ${skillId}`);
    }
  }
});

test("the Task Manager Commons entry is discoverable and carries no personal data", () => {
  const entry = COMMONS_BUILT_IN_MODULES.find((candidate) => candidate.manifest.name === "task-manager");
  assert.ok(entry, "Task Manager must be publishable to Commons");

  // Discoverable: Commons exists so someone with a NEED can find the
  // capability that meets it. An entry tagged only `built-in` + its kind is
  // present but unfindable.
  assert.ok(
    entry.commons.tags.some((tag) => tag.startsWith("need:")),
    "a Commons entry nobody can find by need is shelfware",
  );
  assert.ok(entry.commons.provenance, "every Commons entry names where it came from");

  // No personal data. Commons never stores it, and the audit has to be over
  // the SERIALIZED entry rather than a hand-picked field, because a leak
  // arrives in whatever field nobody thought to check.
  const serialized = JSON.stringify(entry);
  for (const forbidden of ["@", "PILOT_USER", "e0f0053b", "manishsbhoopalam", "dev.bridge.ai"]) {
    assert.ok(
      !serialized.includes(forbidden),
      `the Commons entry must not carry personal data (found ${forbidden})`,
    );
  }
  // Nothing in the entry may be a UUID: every id is a stable kebab-case
  // manifest id, and a UUID here would be a runtime row leaking into a
  // published Module.
  assert.ok(
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(serialized),
    "a UUID in a Commons entry is a runtime row that escaped into a published Module",
  );
});
