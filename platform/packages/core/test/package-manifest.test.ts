import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePackageManifest, PackageManifestValidationError } from "../src/index.js";

function rawManifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    package: {
      name: "dummy-package",
      version: "1.0.0",
      kind: "workspace_definition",
      summary: "dummy summary",
      description: "dummy description",
      dependencies: [],
      capabilities: [
        {
          id: "dummy.cap-one",
          capability_type: "skill",
          permissions: [{ resource_type: "touchpoint", action: "write", data_scope: "private", egress: false }],
          connectors: [],
        },
      ],
      ...overrides,
    },
  };
}

test("parsePackageManifest: valid manifest parses with defaults", () => {
  const parsed = parsePackageManifest(rawManifest());
  assert.equal(parsed.name, "dummy-package");
  assert.equal(parsed.version, "1.0.0");
  assert.equal(parsed.kind, "workspace_definition");
  assert.equal(parsed.capabilities.length, 1);
  assert.equal(parsed.capabilities[0]?.id, "dummy.cap-one");
  assert.equal(parsed.capabilities[0]?.permissions[0]?.resourceType, "touchpoint");
  assert.deepEqual(parsed.workspaceVocab, { alignsToBridgeTheme: true, domainTerms: {} });
  assert.equal(parsed.lineageManifestId, null);
});

test("parsePackageManifest: rejects non-semver version", () => {
  assert.throws(() => parsePackageManifest(rawManifest({ version: "1.0" })), PackageManifestValidationError);
});

test("parsePackageManifest: rejects a version range in a dependency", () => {
  assert.throws(
    () => parsePackageManifest(rawManifest({ dependencies: [{ manifestId: "other-pkg", version: "^2.0.0" }] })),
    PackageManifestValidationError,
  );
});

test("parsePackageManifest: accepts an exact-pinned dependency version", () => {
  const parsed = parsePackageManifest(rawManifest({ dependencies: [{ manifestId: "other-pkg", version: "2.1.0" }] }));
  assert.equal(parsed.dependencies[0]?.version, "2.1.0");
});

test("parsePackageManifest: rejects zero capabilities", () => {
  assert.throws(() => parsePackageManifest(rawManifest({ capabilities: [] })), PackageManifestValidationError);
});

test("parsePackageManifest: rejects non-kebab-case name", () => {
  assert.throws(() => parsePackageManifest(rawManifest({ name: "Dummy_Package" })), PackageManifestValidationError);
});

test("parsePackageManifest: rejects an invalid kind", () => {
  assert.throws(() => parsePackageManifest(rawManifest({ kind: "product" })), PackageManifestValidationError);
});

test("parsePackageManifest: rejects duplicate capability ids", () => {
  const dup = rawManifest({
    capabilities: [
      { id: "dummy.same", capability_type: "skill", permissions: [] },
      { id: "dummy.same", capability_type: "skill", permissions: [] },
    ],
  });
  assert.throws(() => parsePackageManifest(dup), PackageManifestValidationError);
});

test("parsePackageManifest: description over 1024 chars rejected", () => {
  assert.throws(
    () => parsePackageManifest(rawManifest({ description: "x".repeat(1025) })),
    PackageManifestValidationError,
  );
});

test("parsePackageManifest: reads workspace_vocab snake_case keys", () => {
  const parsed = parsePackageManifest(
    rawManifest({ workspace_vocab: { aligns_to_bridge_theme: false, domain_terms: { listing: "Initiative-shaped" } } }),
  );
  assert.equal(parsed.workspaceVocab.alignsToBridgeTheme, false);
  assert.equal(parsed.workspaceVocab.domainTerms.listing, "Initiative-shaped");
});

test("parsePackageManifest: validates Module Agent-owned Skills and Automations", () => {
  const parsed = parsePackageManifest(
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
});

test("parsePackageManifest: rejects a Commons need without an attributable Module Agent", () => {
  assert.throws(
    () =>
      parsePackageManifest(
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

test("parsePackageManifest: rejects a Module display name that traverses the File root", () => {
  for (const displayName of [" . ", " .. "]) {
    assert.throws(
      () =>
        parsePackageManifest(
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

test("parsePackageManifest: rejects a Module Skill not owned by a declared capability", () => {
  assert.throws(
    () =>
      parsePackageManifest(
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
