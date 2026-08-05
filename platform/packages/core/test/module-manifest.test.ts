import { test } from "node:test";
import assert from "node:assert/strict";

import { parseModuleManifest, ModuleManifestValidationError } from "../src/index.js";

function rawManifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    module: {
      name: "dummy-module",
      version: "1.0.0",
      kind: "organization_definition",
      summary: "dummy summary",
      description: "dummy description",
      dependencies: [],
      capabilities: [
        {
          id: "dummy.cap-one",
          capability_type: "skill",
          permissions: [{ resource_type: "event", action: "write", data_scope: "private", egress: false }],
          connectors: [],
        },
      ],
      ...overrides,
    },
  };
}

test("parseModuleManifest: valid manifest parses with defaults", () => {
  const parsed = parseModuleManifest(rawManifest());
  assert.equal(parsed.name, "dummy-module");
  assert.equal(parsed.version, "1.0.0");
  assert.equal(parsed.kind, "organization_definition");
  assert.equal(parsed.capabilities.length, 1);
  assert.equal(parsed.capabilities[0]?.id, "dummy.cap-one");
  assert.equal(parsed.capabilities[0]?.permissions[0]?.resourceType, "event");
  assert.deepEqual(parsed.organizationVocab, { alignsToBridgeTheme: true, domainTerms: {} });
  assert.equal(parsed.lineageManifestId, null);
});

test("parseModuleManifest: rejects non-semver version", () => {
  assert.throws(() => parseModuleManifest(rawManifest({ version: "1.0" })), ModuleManifestValidationError);
});

test("parseModuleManifest: rejects a version range in a dependency", () => {
  assert.throws(
    () => parseModuleManifest(rawManifest({ dependencies: [{ manifestId: "other-pkg", version: "^2.0.0" }] })),
    ModuleManifestValidationError,
  );
});

test("parseModuleManifest: accepts an exact-pinned dependency version", () => {
  const parsed = parseModuleManifest(rawManifest({ dependencies: [{ manifestId: "other-pkg", version: "2.1.0" }] }));
  assert.equal(parsed.dependencies[0]?.version, "2.1.0");
});

test("parseModuleManifest: rejects zero capabilities", () => {
  assert.throws(() => parseModuleManifest(rawManifest({ capabilities: [] })), ModuleManifestValidationError);
});

test("parseModuleManifest: rejects non-kebab-case name", () => {
  assert.throws(() => parseModuleManifest(rawManifest({ name: "Dummy_Module" })), ModuleManifestValidationError);
});

test("parseModuleManifest: rejects an invalid kind", () => {
  assert.throws(() => parseModuleManifest(rawManifest({ kind: "product" })), ModuleManifestValidationError);
});

test("parseModuleManifest: rejects duplicate capability ids", () => {
  const dup = rawManifest({
    capabilities: [
      { id: "dummy.same", capability_type: "skill", permissions: [] },
      { id: "dummy.same", capability_type: "skill", permissions: [] },
    ],
  });
  assert.throws(() => parseModuleManifest(dup), ModuleManifestValidationError);
});

test("parseModuleManifest: description over 1024 chars rejected", () => {
  assert.throws(
    () => parseModuleManifest(rawManifest({ description: "x".repeat(1025) })),
    ModuleManifestValidationError,
  );
});

test("parseModuleManifest: reads organization_vocab snake_case keys", () => {
  const parsed = parseModuleManifest(
    rawManifest({ organization_vocab: { aligns_to_bridge_theme: false, domain_terms: { listing: "Record-shaped" } } }),
  );
  assert.equal(parsed.organizationVocab.alignsToBridgeTheme, false);
  assert.equal(parsed.organizationVocab.domainTerms.listing, "Record-shaped");
});

test("parseModuleManifest: validates Module Agent-owned Skills and Automations", () => {
  const parsed = parseModuleManifest(
    rawManifest({
      capabilities: [
        { id: "dummy.view", capability_type: "view", permissions: [] },
        { id: "dummy.skill", capability_type: "skill", permissions: [] },
        { id: "dummy.agent", capability_type: "agent", permissions: [] },
        { id: "dummy.automation", capability_type: "automation", permissions: [] },
      ],
      module: {
        display_name: "Dummy",
        route: "/dummy",
        pages: [{ id: "records", name: "Records", route: "/dummy", database_id: "dummy.records", capability_id: "dummy.view" }],
        agents: [{ id: "operator", name: "Operator", capability_id: "dummy.agent", skill_ids: ["dummy.skill"] }],
        automations: [{
          id: "intake",
          name: "Intake",
          capability_id: "dummy.automation",
          agent_id: "operator",
          trigger: "Manual",
          procedure: "dummy.intake",
          automation_id: "dummy.intake.automation",
          run_route: "/dummy/records",
        }],
        commons_needs: [{
          id: "calendar-availability",
          title: "Check availability",
          description: "Read Calendar availability before proposing a time.",
          agent_id: "operator",
          kind: "skill",
          tags: ["need:calendar-availability"],
        }],
      },
    }),
  );

  assert.equal(parsed.module?.displayName, "Dummy");
  assert.deepEqual(parsed.module?.agents[0]?.skillIds, ["dummy.skill"]);
  assert.equal(parsed.module?.automations[0]?.agentId, "operator");
  assert.equal(parsed.module?.automations[0]?.automationId, "dummy.intake.automation");
  assert.equal(parsed.module?.automations[0]?.runRoute, "/dummy/records");
  assert.equal(parsed.module?.commonsNeeds?.[0]?.agentId, "operator");
  assert.equal(
    parseModuleManifest(parsed).module?.displayName,
    "Dummy",
    "a canonical direct manifest must not mistake its Module surface for a wrapper",
  );
});

test("parseModuleManifest: rejects a Commons need without an attributable Module Agent", () => {
  assert.throws(
    () =>
      parseModuleManifest(
        rawManifest({
          capabilities: [
            { id: "dummy.agent", capability_type: "agent", permissions: [] },
            { id: "dummy.skill", capability_type: "skill", permissions: [] },
          ],
          module: {
            display_name: "Dummy",
            route: "/dummy",
            pages: [],
            agents: [{ id: "operator", name: "Operator", capability_id: "dummy.agent", skill_ids: ["dummy.skill"] }],
            automations: [],
            commons_needs: [{
              id: "missing-owner",
              title: "Missing owner",
              description: "This need names an undeclared Agent.",
              agent_id: "other-agent",
              kind: "skill",
              tags: ["need:missing-owner"],
            }],
          },
        }),
      ),
    /declared module agent/,
  );
});

test("parseModuleManifest: parses a sub-module's parent_module in either casing", () => {
  for (const key of ["parent_module", "parentModule"]) {
    const parsed = parseModuleManifest(
      rawManifest({
        module: {
          display_name: "Dummy",
          route: "/dummy",
          [key]: "network-manager",
          pages: [],
          agents: [],
          automations: [],
        },
      }),
    );
    assert.equal(parsed.module?.parentModule, "network-manager");
  }
});

test("parseModuleManifest: a Module with no parent_module has no parentModule key", () => {
  // Absent must stay ABSENT rather than becoming "" or null — canonicalizeManifest
  // hashes the object, so a phantom key would change every existing signature.
  const parsed = parseModuleManifest(
    rawManifest({
      module: { display_name: "Dummy", route: "/dummy", pages: [], agents: [], automations: [] },
    }),
  );
  assert.equal(parsed.module?.parentModule, undefined);
  assert.equal(Object.hasOwn(parsed.module!, "parentModule"), false);
});

test("parseModuleManifest: rejects a malformed or self-referential parent_module", () => {
  const withParent = (parent: string) =>
    rawManifest({
      module: {
        display_name: "Dummy",
        route: "/dummy",
        parent_module: parent,
        pages: [],
        agents: [],
        automations: [],
      },
    });
  for (const bad of ["Network Manager", "/module/network", "network_manager", ""]) {
    assert.throws(() => parseModuleManifest(withParent(bad)), ModuleManifestValidationError);
  }
  // A Module cannot parent itself — the ONE relational check a single manifest
  // can answer. "Does the parent exist" is deliberately left to nav-build time.
  assert.throws(() => parseModuleManifest(withParent("dummy-module")), /must not name the Module itself/);
  // An unknown-but-well-formed parent PARSES: install order must not decide
  // whether a manifest is valid.
  assert.equal(
    parseModuleManifest(withParent("not-installed-yet")).module?.parentModule,
    "not-installed-yet",
  );
});

test("parseModuleManifest: rejects a Module display name that traverses the File root", () => {
  for (const displayName of [" . ", " .. "]) {
    assert.throws(
      () =>
        parseModuleManifest(
          rawManifest({
            module: {
              display_name: displayName,
              route: "/dummy",
              pages: [],
              agents: [],
              automations: [],
            },
          }),
        ),
      /display_name cannot be a relative path segment/,
    );
  }
});

test("parseModuleManifest: rejects a Module Skill not owned by a declared capability", () => {
  assert.throws(
    () =>
      parseModuleManifest(
        rawManifest({
          capabilities: [
            { id: "dummy.view", capability_type: "view", permissions: [] },
            { id: "dummy.agent", capability_type: "agent", permissions: [] },
          ],
          module: {
            display_name: "Dummy",
            route: "/dummy",
            pages: [{ id: "records", name: "Records", route: "/dummy", database_id: "dummy.records", capability_id: "dummy.view" }],
            agents: [{ id: "operator", name: "Operator", capability_id: "dummy.agent", skill_ids: ["dummy.missing"] }],
            automations: [],
          },
        }),
      ),
    /skill capabilities/,
  );
});
