import { test } from "node:test";
import assert from "node:assert/strict";

import { compileBlueprint, BlueprintCompileError, type WorkspaceBlueprint } from "../src/index.js";

const REGISTRY = ["initiative", "touchpoint", "relationship"] as const;

function blueprint(overrides: Partial<WorkspaceBlueprint> = {}): WorkspaceBlueprint {
  return {
    vocabulary: {},
    entities: [
      {
        nodeType: "initiative",
        label: "Initiative",
        fields: [
          { id: "name", label: "Name", kind: "text" },
          { id: "stage", label: "Stage", kind: "select", options: ["new", "active", "closed"] },
        ],
      },
    ],
    views: [{ entity: "initiative", kind: "table" }],
    capabilities: [],
    ...overrides,
  };
}

test("valid blueprint compiles: tableSpecs, viewConfigs, navigation all populated", () => {
  const compiled = compileBlueprint(blueprint(), [...REGISTRY]);
  assert.equal(compiled.tableSpecs.length, 1);
  assert.equal(compiled.tableSpecs[0]?.id, "initiative");
  assert.equal(compiled.tableSpecs[0]?.columns.length, 2);
  assert.equal(compiled.viewConfigs.length, 1);
  assert.equal(compiled.viewConfigs[0]?.kind, "table");
  assert.equal(compiled.viewConfigs[0]?.entity, "initiative");
  assert.equal(compiled.navigation.length, 1);
  assert.equal(compiled.navigation[0]?.nodeType, "initiative");
  assert.deepEqual(compiled.navigation[0]?.viewIds, [compiled.viewConfigs[0]?.id]);
});

// ---------------------------------------------------------------------------
// Canonical View eligibility + board groupBy default
// ---------------------------------------------------------------------------

test("convertibleKinds: table/gallery/form are always included and board requires a select column", () => {
  const compiled = compileBlueprint(blueprint(), [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "board", "gallery", "form"]);
});

test("convertibleKinds: adds calendar when a date-kind column exists", () => {
  const bp = blueprint({
    entities: [
      {
        nodeType: "initiative",
        label: "Initiative",
        fields: [
          { id: "name", label: "Name", kind: "text" },
          { id: "due", label: "Due", kind: "date" },
        ],
      },
    ],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "gallery", "form", "calendar"]);
});

test("convertibleKinds: adds map when a location-kind column exists", () => {
  const bp = blueprint({
    entities: [
      {
        nodeType: "initiative",
        label: "Initiative",
        fields: [
          { id: "name", label: "Name", kind: "text" },
          { id: "hq", label: "Headquarters", kind: "location" },
        ],
      },
    ],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "gallery", "form", "map"]);
});

test("convertibleKinds: adds graph when a cross-database relation column exists", () => {
  const bp = blueprint({
    entities: [
      {
        nodeType: "initiative",
        label: "Initiative",
        fields: [
          { id: "name", label: "Name", kind: "text" },
          { id: "owner", label: "Owner", kind: "relation", relationTarget: "person" },
        ],
      },
    ],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "gallery", "form", "graph"]);
});

test("convertibleKinds: all three conditional kinds stack together, in canonical order", () => {
  const bp = blueprint({
    entities: [
      {
        nodeType: "initiative",
        label: "Initiative",
        fields: [
          { id: "name", label: "Name", kind: "text" },
          { id: "due", label: "Due", kind: "date" },
          { id: "hq", label: "Headquarters", kind: "location" },
          { id: "owner", label: "Owner", kind: "relation", relationTarget: "person" },
        ],
      },
    ],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "gallery", "form", "calendar", "map", "graph"]);
});

test("convertibleKinds: a self-parent relation adds tree without incorrectly adding graph", () => {
  const bp = blueprint({
    entities: [
      {
        nodeType: "initiative",
        label: "Initiative",
        fields: [
          { id: "name", label: "Name", kind: "text" },
          { id: "parent", label: "Parent", kind: "relation", relationTarget: "initiative", relationParent: true },
        ],
      },
    ],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "gallery", "form", "tree"]);
});

test("convertibleKinds: non-tabular views (chatbot/dashboard/canvas) carry an empty array", () => {
  const bp = blueprint({ views: [{ entity: "initiative", kind: "dashboard" }] });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, []);
});

test("board groupBy: defaults to the entity's select-kind column when the blueprint doesn't specify one", () => {
  const bp = blueprint({ views: [{ entity: "initiative", kind: "board" }] });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.viewConfigs[0]?.groupBy, "stage");
});

test("board groupBy: an explicit eligible config.groupBy always wins over the default", () => {
  const bp = blueprint({ views: [{ entity: "initiative", kind: "board", config: { groupBy: "stage" } }] });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.viewConfigs[0]?.groupBy, "stage");
});

test("board groupBy: an explicit null means intentionally ungrouped, not defaulted", () => {
  const bp = blueprint({ views: [{ entity: "initiative", kind: "board", config: { groupBy: null } }] });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.viewConfigs[0]?.groupBy, null);
});

test("board is rejected when the entity has no select-kind column", () => {
  const bp = blueprint({
    entities: [{ nodeType: "initiative", label: "Initiative", fields: [{ id: "name", label: "Name", kind: "text" }] }],
    views: [{ entity: "initiative", kind: "board" }],
  });
  assert.throws(() => compileBlueprint(bp, [...REGISTRY]), BlueprintCompileError);
});

test("non-board view kinds are never defaulted a groupBy", () => {
  const compiled = compileBlueprint(blueprint(), [...REGISTRY]); // default view kind is "table"
  assert.equal(compiled.viewConfigs[0]?.groupBy, null);
});

test("invalid view kind is rejected", () => {
  const bp = blueprint({ views: [{ entity: "initiative", kind: "not_a_real_kind" as never }] });
  assert.throws(() => compileBlueprint(bp, [...REGISTRY]), BlueprintCompileError);
});

test("unknown node type is rejected against the provided registry", () => {
  const bp = blueprint({
    entities: [{ nodeType: "unregistered_thing", label: "Nope", fields: [] }],
    views: [],
  });
  assert.throws(() => compileBlueprint(bp, [...REGISTRY]), BlueprintCompileError);
});

test("view referencing an entity not declared in the blueprint is rejected", () => {
  const bp = blueprint({ views: [{ entity: "touchpoint", kind: "table" }] });
  assert.throws(() => compileBlueprint(bp, [...REGISTRY]), BlueprintCompileError);
});

test("an ineligible view kind is rejected from the entity's column metadata", () => {
  const bp = blueprint({
    entities: [{ nodeType: "relationship", label: "Relationship", fields: [] }],
    views: [{ entity: "relationship", kind: "board" }],
  });
  assert.throws(() => compileBlueprint(bp, [...REGISTRY]), BlueprintCompileError);
});

test("relationship view accepts table", () => {
  const bp = blueprint({
    entities: [{ nodeType: "relationship", label: "Relationship", fields: [] }],
    views: [{ entity: "relationship", kind: "table" }],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.viewConfigs[0]?.kind, "table");
});

test("relationship view accepts graph when it declares a typed relation column", () => {
  const bp = blueprint({
    entities: [
      {
        nodeType: "relationship",
        label: "Relationship",
        fields: [{ id: "person", label: "Person", kind: "relation", relationTarget: "person" }],
      },
    ],
    views: [{ entity: "relationship", kind: "graph" }],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.viewConfigs[0]?.kind, "graph");
  assert.equal(compiled.viewConfigs[0]?.relationBy, "person");
  assert.equal(compiled.viewConfigs[0]?.graphScope, "single_database");
});

test("non-tabular view kinds (chatbot/dashboard/canvas) compile through with no TableSpec required", () => {
  const bp = blueprint({ views: [{ entity: "initiative", kind: "dashboard" }] });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.viewConfigs[0]?.kind, "dashboard");
});

test("vocabulary override applied to entity + field labels", () => {
  const bp = blueprint({
    vocabulary: { Initiative: "Deal", Name: "Deal Name" },
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.navigation[0]?.label, "Deal");
  assert.equal(compiled.tableSpecs[0]?.columns[0]?.label, "Deal Name");
  // Unmapped label passes through unchanged.
  assert.equal(compiled.tableSpecs[0]?.columns[1]?.label, "Stage");
});

test("duplicate entity node types are rejected", () => {
  const bp = blueprint({
    entities: [
      { nodeType: "initiative", label: "Initiative", fields: [] },
      { nodeType: "initiative", label: "Initiative Again", fields: [] },
    ],
    views: [],
  });
  assert.throws(() => compileBlueprint(bp, [...REGISTRY]), BlueprintCompileError);
});
