import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseWorkspaceBlueprint,
  workspaceBlueprintToPackageManifest,
  workspaceBlueprintFromPackageManifest,
  parsePackageManifest,
  compileBlueprint,
  BlueprintValidationError,
  BLUEPRINT_SCHEMA_VERSION,
  type WorkspaceBlueprint,
} from "../src/index.js";

const REGISTRY = ["person", "relationship"] as const;

function validBlueprint(): WorkspaceBlueprint {
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
      { entity: "person", kind: "kanban", config: { groupBy: "stage" } },
    ],
    capabilities: ["cap-manifest-1"],
  };
}

test("parseWorkspaceBlueprint: accepts a valid declarative blueprint and stamps schemaVersion", () => {
  const parsed = parseWorkspaceBlueprint(validBlueprint());
  assert.equal(parsed.schemaVersion, BLUEPRINT_SCHEMA_VERSION);
  assert.equal(parsed.entities.length, 1);
  assert.equal(parsed.views.length, 2);
});

test("parseWorkspaceBlueprint: rejects an unknown TOP-LEVEL key (no smuggled code)", () => {
  const payload = { ...validBlueprint(), code: "() => fetch('http://evil')" };
  assert.throws(() => parseWorkspaceBlueprint(payload), BlueprintValidationError);
});

test("parseWorkspaceBlueprint: rejects a smuggled key inside an entity field (declarative gate)", () => {
  const bp = validBlueprint();
  const payload = {
    ...bp,
    entities: [{ ...bp.entities[0], fields: [{ id: "x", label: "X", kind: "text", handler: "run()" }] }],
  };
  assert.throws(() => parseWorkspaceBlueprint(payload), BlueprintValidationError);
});

test("parseWorkspaceBlueprint: rejects a future schemaVersion this kernel does not understand", () => {
  const payload = { ...validBlueprint(), schemaVersion: BLUEPRINT_SCHEMA_VERSION + 1 };
  assert.throws(() => parseWorkspaceBlueprint(payload), BlueprintValidationError);
});

test("parseWorkspaceBlueprint: rejects a non-object / bad field kind", () => {
  assert.throws(() => parseWorkspaceBlueprint(null), BlueprintValidationError);
  const bp = validBlueprint();
  const badKind = { ...bp, entities: [{ ...bp.entities[0], fields: [{ id: "x", label: "X", kind: "wormhole" }] }] };
  assert.throws(() => parseWorkspaceBlueprint(badKind), BlueprintValidationError);
});

test("BLUEPRINT-1 round-trip: blueprint -> publish manifest -> (re-parse) -> install -> compile", () => {
  const bp = validBlueprint();

  // publish side: bridge to a Commons-publishable package manifest
  const manifest = workspaceBlueprintToPackageManifest(bp, { name: "test-fixture-ws", version: "1.0.0" });
  assert.equal(manifest.kind, "workspace_definition");
  assert.deepEqual(manifest.capabilities, []); // composes by reference, bundles none

  // the Commons server parses the posted manifest — the blueprint must survive
  const republished = parsePackageManifest(JSON.parse(JSON.stringify(manifest)));
  assert.ok(republished.blueprint, "blueprint payload survives parsePackageManifest");

  // install side: extract + re-validate the blueprint from the installed manifest
  const installed = workspaceBlueprintFromPackageManifest(republished);
  assert.deepEqual(installed, { ...bp, schemaVersion: BLUEPRINT_SCHEMA_VERSION });

  // compile the round-tripped blueprint — grammar enforcement intact
  const compiled = compileBlueprint(installed, REGISTRY, ["relationship"]);
  assert.equal(compiled.tableSpecs.length, 1);
  assert.equal(compiled.navigation[0]?.nodeType, "person");
  const kanban = compiled.viewConfigs.find((v) => v.kind === "kanban");
  assert.equal(kanban?.groupBy, "stage");
});

test("workspaceBlueprintFromPackageManifest: rejects a non-workspace_definition manifest", () => {
  const notWorkspace = parsePackageManifest({
    name: "test-fixture-tool",
    version: "1.0.0",
    kind: "tool",
    summary: "s",
    capabilities: [{ id: "c", capabilityType: "tool", permissions: [] }],
  });
  assert.throws(() => workspaceBlueprintFromPackageManifest(notWorkspace), BlueprintValidationError);
});

test("parsePackageManifest: a workspace_definition WITHOUT a blueprint still requires >=1 capability", () => {
  assert.throws(
    () =>
      parsePackageManifest({
        name: "test-fixture-empty-ws",
        version: "1.0.0",
        kind: "workspace_definition",
        summary: "s",
        capabilities: [],
      }),
    /at least one capability/,
  );
});
