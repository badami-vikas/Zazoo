import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseOrganizationBlueprint,
  organizationBlueprintToModuleManifest,
  organizationBlueprintFromModuleManifest,
  parseModuleManifest,
  compileBlueprint,
  BlueprintValidationError,
  BLUEPRINT_SCHEMA_VERSION,
  type OrganizationBlueprint,
} from "../src/index.js";

const REGISTRY = ["person", "relationship"] as const;

function validBlueprint(): OrganizationBlueprint {
  return {
    vocabulary: { Person: "Contact" },
    entities: [
      {
        nodeType: "person",
        label: "Person",
        fields: [
          { id: "name", label: "Name", kind: "text" },
          { id: "stage", label: "Stage", kind: "select", options: ["a", "b"] },
        ],
      },
    ],
    views: [
      { entity: "person", kind: "table" },
      { entity: "person", kind: "board", config: { groupBy: "stage" } },
    ],
    capabilities: ["cap-manifest-1"],
  };
}

test("parseOrganizationBlueprint: accepts a valid declarative blueprint and stamps schemaVersion", () => {
  const parsed = parseOrganizationBlueprint(validBlueprint());
  assert.equal(parsed.schemaVersion, BLUEPRINT_SCHEMA_VERSION);
  assert.equal(parsed.entities.length, 1);
  assert.equal(parsed.views.length, 2);
});

test("parseOrganizationBlueprint: rejects an unknown TOP-LEVEL key (no smuggled code)", () => {
  const payload = { ...validBlueprint(), code: "() => fetch('http://evil')" };
  assert.throws(() => parseOrganizationBlueprint(payload), BlueprintValidationError);
});

test("parseOrganizationBlueprint: rejects a smuggled key inside an entity field (declarative gate)", () => {
  const bp = validBlueprint();
  const payload = {
    ...bp,
    entities: [{ ...bp.entities[0], fields: [{ id: "x", label: "X", kind: "text", handler: "run()" }] }],
  };
  assert.throws(() => parseOrganizationBlueprint(payload), BlueprintValidationError);
});

test("parseOrganizationBlueprint: rejects a future schemaVersion this kernel does not understand", () => {
  const payload = { ...validBlueprint(), schemaVersion: BLUEPRINT_SCHEMA_VERSION + 1 };
  assert.throws(() => parseOrganizationBlueprint(payload), BlueprintValidationError);
});

test("parseOrganizationBlueprint: rejects a non-object / bad field kind", () => {
  assert.throws(() => parseOrganizationBlueprint(null), BlueprintValidationError);
  const bp = validBlueprint();
  const badKind = { ...bp, entities: [{ ...bp.entities[0], fields: [{ id: "x", label: "X", kind: "wormhole" }] }] };
  assert.throws(() => parseOrganizationBlueprint(badKind), BlueprintValidationError);
});

test("BLUEPRINT-1 round-trip: blueprint -> publish manifest -> (re-parse) -> install -> compile", () => {
  const bp = validBlueprint();

  // publish side: bridge to a Commons-publishable module manifest
  const manifest = organizationBlueprintToModuleManifest(bp, { name: "test-fixture-ws", version: "1.0.0" });
  assert.equal(manifest.kind, "organization_definition");
  assert.deepEqual(manifest.capabilities, []); // composes by reference, bundles none

  // the Commons server parses the posted manifest — the blueprint must survive
  const republished = parseModuleManifest(JSON.parse(JSON.stringify(manifest)));
  assert.ok(republished.blueprint, "blueprint payload survives parseModuleManifest");

  // install side: extract + re-validate the blueprint from the installed manifest
  const installed = organizationBlueprintFromModuleManifest(republished);
  assert.deepEqual(installed, { ...bp, schemaVersion: BLUEPRINT_SCHEMA_VERSION });

  // compile the round-tripped blueprint — grammar enforcement intact
  const compiled = compileBlueprint(installed, REGISTRY, ["relationship"]);
  assert.equal(compiled.tableSpecs.length, 1);
  assert.equal(compiled.navigation[0]?.nodeType, "person");
  const board = compiled.viewConfigs.find((v) => v.kind === "board");
  assert.equal(board?.groupBy, "stage");
});

test("parseOrganizationBlueprint: migrates explicit version-1 view aliases and emits version 2", () => {
  const legacy = {
    ...validBlueprint(),
    schemaVersion: 1,
    views: [
      { entity: "person", kind: "kanban", config: { groupBy: "stage" } },
      { entity: "person", kind: "network" },
    ],
  };
  const parsed = parseOrganizationBlueprint(legacy);
  assert.equal(parsed.schemaVersion, BLUEPRINT_SCHEMA_VERSION);
  assert.deepEqual(parsed.views.map((view) => view.kind), ["board", "graph"]);
});

test("parseOrganizationBlueprint: rejects version-1 aliases in a version-2 payload", () => {
  const payload = {
    ...validBlueprint(),
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    views: [{ entity: "person", kind: "kanban" }],
  };
  assert.throws(() => parseOrganizationBlueprint(payload), BlueprintValidationError);
});

test("organizationBlueprintFromModuleManifest: rejects a non-organization_definition manifest", () => {
  const notOrganization = parseModuleManifest({
    name: "test-fixture-tool",
    version: "1.0.0",
    kind: "module",
    summary: "s",
    capabilities: [{ id: "c", capabilityType: "skill", permissions: [] }],
  });
  assert.throws(() => organizationBlueprintFromModuleManifest(notOrganization), BlueprintValidationError);
});

test("parseModuleManifest: a organization_definition WITHOUT a blueprint still requires >=1 capability", () => {
  assert.throws(
    () =>
      parseModuleManifest({
        name: "test-fixture-empty-ws",
        version: "1.0.0",
        kind: "organization_definition",
        summary: "s",
        capabilities: [],
      }),
    /at least one capability/,
  );
});
