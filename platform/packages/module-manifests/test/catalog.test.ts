import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILT_IN_MODULES,
  COMMONS_BUILT_IN_MODULES,
  EGG_MODULES,
  MODULE_RUNTIME_IDS,
  isModuleRuntimeAutomationId,
  moduleNavTarget,
  requireBuiltInModule,
  resolveModuleAgentRuntimeId,
  resolveModuleAutomationRuntimeId,
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
  // Commons carries the DEFINITION; Help items are the owner's own and stay on
  // their Local Plane. Publishing the Module publishes its Databases and
  // capability declarations, never a row (ADR 2026-09-11).
  const helpdeskEntry = COMMONS_BUILT_IN_MODULES.find((pkg) => pkg.manifest.name === "helpdesk");
  assert.ok(helpdeskEntry, "Helpdesk is discoverable in Commons");
  assert.ok(helpdeskEntry.commons.provenance, "a Commons entry must declare where it came from");
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

test("every built-in Module is discoverable in Commons, carrying no rows", () => {
  // The inverse of what this test used to assert. Five Modules — relationship,
  // whatsapp, helpdesk, events, devpilot — were withheld on the grounds that
  // their DATA is private. Their data is; their manifests are not (ADR
  // 2026-09-11 "A manifest is a definition, not a dossier"). Installer risk is
  // the install-time gate's job, not a publish-time allowlist's.
  const published = new Set(COMMONS_BUILT_IN_MODULES.map(({ manifest }) => manifest.name));
  for (const { manifest } of BUILT_IN_MODULES) {
    assert.ok(published.has(manifest.name), `${manifest.name} must be discoverable in Commons`);
  }
  // The actual invariant: what ships is a definition. No entry carries rows.
  for (const entry of COMMONS_BUILT_IN_MODULES) {
    const serialized = JSON.stringify(entry.manifest);
    const asRecord = entry.manifest as unknown as Record<string, unknown>;
    assert.equal(asRecord.records, undefined, `${entry.manifest.name} carries records`);
    assert.equal(asRecord.rows, undefined, `${entry.manifest.name} carries rows`);
    assert.equal(asRecord.seed, undefined, `${entry.manifest.name} carries seed data`);
    assert.ok(!/"rows"\s*:/.test(serialized), `${entry.manifest.name} carries rows`);
    assert.ok(entry.commons.provenance, `${entry.manifest.name} must declare provenance`);
  }
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

test("DevPilot is published to Commons as a shape, not as anyone's repos", () => {
  const entry = COMMONS_BUILT_IN_MODULES.find(({ manifest }) => manifest.name === "devpilot");
  assert.ok(entry, "DevPilot is discoverable in Commons");
  // "Sync the repos you track, with a token you supply" is exactly as
  // generalized as "read your inbox" — which has always been in Commons. What
  // must never appear is a repo name, an owner, or a token.
  const serialized = JSON.stringify(entry.manifest);
  assert.ok(!/ghp_|github_pat_/.test(serialized), "no token material in a published manifest");
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

// ---------------------------------------------------------------------
// TASK-069 in the ADR 2026-09-04 ("The Egg ships the kernel; Modules live
// in Commons") form: Academics is a Commons manifest with declared Databases
// and no code of its own, and the Egg does not seed it.
// ---------------------------------------------------------------------

test("Academics declares three Databases, one Page each, and lives in Commons but not the Egg", () => {
  const academics = requireBuiltInModule("academics").manifest;
  assert.deepEqual(
    academics.module?.databases?.map((database) => database.id),
    ["subjects", "lecture-sessions", "assignments"],
  );
  assert.deepEqual(
    academics.module?.pages.map((page) => page.databaseId),
    ["subjects", "lecture-sessions", "assignments"],
  );
  const columns = (databaseId: string) =>
    academics.module?.databases?.find((database) => database.id === databaseId)?.columns ?? [];
  assert.deepEqual(columns("subjects").map((column) => column.id), ["name", "code", "term", "instructor", "credits"]);
  assert.deepEqual(
    columns("lecture-sessions").map((column) => [column.id, column.kind]),
    [["subject", "relation"], ["date", "date"], ["topic", "text"], ["notes_summary", "text"], ["recording_link", "url"]],
  );
  assert.deepEqual(
    columns("assignments").find((column) => column.id === "status")?.options,
    ["not_started", "in_progress", "submitted", "graded"],
  );
  // Study Steward: Local Plane, no Skills yet (they are follow-on Tasks).
  assert.deepEqual(
    academics.module?.agents.map((agent) => [agent.id, agent.plane, agent.skillIds]),
    [["study-steward", "local", []]],
  );
  for (const capability of academics.capabilities) {
    for (const permission of capability.permissions) {
      assert.equal(permission.egress, false, `${capability.id} declares egress`);
      assert.equal(permission.dataScope, "private", `${capability.id} is not private-scoped`);
    }
  }
  const entry = COMMONS_BUILT_IN_MODULES.find((candidate) => candidate.manifest.name === "academics");
  assert.ok(entry, "Academics is a Commons entry");
  assert.ok(entry.commons.tags.some((tag) => tag.startsWith("need:")));
  assert.ok(!EGG_MODULES.has("academics"), "the Egg ships the kernel only");
  const normalized = parseModuleManifest({ module: academics });
  assert.equal(
    canonicalizeManifest(parseModuleManifest({ module: normalized })),
    canonicalizeManifest(normalized),
  );
});

// Snapshot taken from the built catalog on 2026-09-11, BEFORE the if-chains
// became the MODULE_RUNTIME_IDS table. These UUIDs are persisted identity in
// the agents/automations tables; a changed value orphans rows.
const RUNTIME_ID_SNAPSHOT: ReadonlyArray<readonly ["automation" | "agent", string, string, string]> = [
  ["automation", "deal-pilot", "deal-pilot.source-intake", "b0000000-0000-4000-a000-0000000000f1"],
  ["agent", "deal-pilot", "sourcing-agent", "b0000000-0000-4000-a000-0000000000e1"],
  ["agent", "relationship", "learning-agent", "b0000000-0000-4000-a000-0000000000d2"],
  ["automation", "task-manager", "task-manager.task-created-impact-analysis", "b0000000-0000-4000-a000-000000000104"],
  ["automation", "task-manager", "task-manager.agent-task-routing-on-assign", "b0000000-0000-4000-a000-000000000108"],
  ["automation", "task-manager", "task-manager.reschedule-approval-gate", "b0000000-0000-4000-a000-000000000101"],
  ["automation", "task-manager", "task-manager.routing-approval-gate", "b0000000-0000-4000-a000-000000000102"],
  ["automation", "task-manager", "task-manager.task-tree-restructure-proposal", "b0000000-0000-4000-a000-000000000105"],
  ["automation", "task-manager", "task-manager.target-change-reopen-prompt", "b0000000-0000-4000-a000-000000000106"],
  ["automation", "task-manager", "task-manager.proactive-scan-cadence", "b0000000-0000-4000-a000-0000000000fa"],
  ["automation", "task-manager", "task-manager.completed-bay-sweep", "b0000000-0000-4000-a000-0000000000f8"],
  ["automation", "task-manager", "task-manager.wip-breach-detector", "b0000000-0000-4000-a000-0000000000ff"],
  ["automation", "task-manager", "task-manager.unverified-done-challenger", "b0000000-0000-4000-a000-000000000100"],
  ["automation", "task-manager", "task-manager.dependency-unblock-notifier", "b0000000-0000-4000-a000-000000000107"],
  ["automation", "task-manager", "task-manager.ledger-drift-detector", "b0000000-0000-4000-a000-0000000000f7"],
  ["automation", "task-manager", "task-manager.stale-task-review", "b0000000-0000-4000-a000-0000000000fe"],
  ["automation", "task-manager", "task-manager.goal-review-cadence", "b0000000-0000-4000-a000-000000000103"],
  ["automation", "task-manager", "task-manager.standup-brief", "b0000000-0000-4000-a000-0000000000fd"],
  ["automation", "task-manager", "task-manager.planning-playbook", "b0000000-0000-4000-a000-0000000000fc"],
  ["agent", "task-manager", "learning-agent", "b0000000-0000-4000-a000-0000000000d2"],
  ["agent", "task-manager", "capability-builder", "b0000000-0000-4000-a000-0000000000d5"],
  ["agent", "task-manager", "chief-of-staff", "b0000000-0000-4000-a000-0000000000d6"],
  ["agent", "task-manager", "internal-strategist", "b0000000-0000-4000-a000-0000000000d3"],
  ["agent", "task-manager", "governance-agent", "b0000000-0000-4000-a000-0000000000d4"],
  ["automation", "devpilot", "devpilot.github-poll", "b0000000-0000-4000-a000-00000000010a"],
  ["automation", "devpilot", "devpilot.review-pr", "b0000000-0000-4000-a000-00000000010c"],
  ["automation", "devpilot", "devpilot.suggest-practice", "b0000000-0000-4000-a000-00000000010d"],
  ["automation", "devpilot", "devpilot.analyze-issue", "b0000000-0000-4000-a000-00000000010e"],
  ["agent", "devpilot", "tracker-agent", "b0000000-0000-4000-a000-000000000109"],
  ["agent", "devpilot", "reviewer-agent", "b0000000-0000-4000-a000-00000000010b"],
];

test("MODULE_RUNTIME_IDS yields exactly the pre-refactor runtime ids for every (module, key) pair", () => {
  for (const [kind, moduleName, key, id] of RUNTIME_ID_SNAPSHOT) {
    const resolved = kind === "automation"
      ? resolveModuleAutomationRuntimeId(moduleName, key)
      : resolveModuleAgentRuntimeId(moduleName, key);
    assert.equal(resolved, id, `${kind} ${moduleName}/${key}`);
    if (kind === "automation") assert.ok(isModuleRuntimeAutomationId(id), `${id} not recognised as a runtime Automation id`);
  }
  // No pair appeared or vanished: the table is exactly the snapshot.
  const fromTable = Object.entries(MODULE_RUNTIME_IDS).flatMap(([moduleName, ids]) => [
    ...Object.entries(ids.automations).map(([key, id]) => ["automation", moduleName, key, id]),
    ...Object.entries(ids.agents).map(([key, id]) => ["agent", moduleName, key, id]),
  ]);
  assert.equal(fromTable.length, RUNTIME_ID_SNAPSHOT.length);
  // Learning Agent is one identity bound by two Modules (the Egg rule); every
  // other id is unique.
  const ids = new Set(fromTable.map(([, , , id]) => id));
  assert.equal(ids.size, fromTable.length - 1, "runtime ids must be unique across Modules");
  // Every declared runtime id belongs to an Agent/Automation the manifest actually declares.
  for (const [moduleName, runtimeIds] of Object.entries(MODULE_RUNTIME_IDS)) {
    const pkg = BUILT_IN_MODULES.find((candidate) => candidate.manifest.name === moduleName);
    assert.ok(pkg, `${moduleName} has runtime ids but no catalog entry`);
    const agentIds = new Set(pkg.manifest.module?.agents.map((agent) => agent.id));
    const automationKeys = new Set(pkg.manifest.module?.automations.map((automation) => automation.automationId));
    for (const key of Object.keys(runtimeIds.agents)) assert.ok(agentIds.has(key), `${moduleName} declares no Agent ${key}`);
    for (const key of Object.keys(runtimeIds.automations)) assert.ok(automationKeys.has(key), `${moduleName} declares no Automation ${key}`);
  }
});
