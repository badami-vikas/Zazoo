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
// View-convertibility grammar + kanban groupBy default (ADR-023 item 6 / ADR-024)
// ---------------------------------------------------------------------------

test("convertibleKinds: table/kanban/card always included for a plain entity with no date/location/relation columns", () => {
  const compiled = compileBlueprint(blueprint(), [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "kanban", "gallery"]);
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
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "kanban", "gallery", "calendar"]);
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
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "kanban", "gallery", "map"]);
});

test("convertibleKinds: adds network (graph) when a relation-kind column exists", () => {
  const bp = blueprint({
    entities: [
      {
        nodeType: "initiative",
        label: "Initiative",
        fields: [
          { id: "name", label: "Name", kind: "text" },
          { id: "owner", label: "Owner", kind: "relation" },
        ],
      },
    ],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "kanban", "gallery", "network"]);
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
          { id: "owner", label: "Owner", kind: "relation" },
        ],
      },
    ],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "kanban", "gallery", "calendar", "map", "network"]);
});

test("convertibleKinds: a relationship entity is restricted to exactly [table, network] regardless of its own columns", () => {
  const bp = blueprint({
    entities: [{ nodeType: "relationship", label: "Relationship", fields: [{ id: "since", label: "Since", kind: "date" }] }],
    views: [{ entity: "relationship", kind: "table" }],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, ["table", "network"]);
});

test("convertibleKinds: non-tabular views (chatbot/dashboard/canvas) carry an empty array", () => {
  const bp = blueprint({ views: [{ entity: "initiative", kind: "dashboard" }] });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.deepEqual(compiled.viewConfigs[0]?.convertibleKinds, []);
});

test("kanban groupBy: defaults to the entity's select-kind column when the blueprint doesn't specify one", () => {
  const bp = blueprint({ views: [{ entity: "initiative", kind: "kanban" }] });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.viewConfigs[0]?.groupBy, "stage");
});

test("kanban groupBy: an explicit config.groupBy always wins over the default", () => {
  const bp = blueprint({ views: [{ entity: "initiative", kind: "kanban", config: { groupBy: "name" } }] });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.viewConfigs[0]?.groupBy, "name");
});

test("kanban groupBy: an explicit null means intentionally ungrouped, not defaulted", () => {
  const bp = blueprint({ views: [{ entity: "initiative", kind: "kanban", config: { groupBy: null } }] });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.viewConfigs[0]?.groupBy, null);
});

test("kanban groupBy: null (not defaulted) when the entity has no select-kind column at all", () => {
  const bp = blueprint({
    entities: [{ nodeType: "initiative", label: "Initiative", fields: [{ id: "name", label: "Name", kind: "text" }] }],
    views: [{ entity: "initiative", kind: "kanban" }],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.viewConfigs[0]?.groupBy, null);
});

test("non-kanban view kinds are never defaulted a groupBy", () => {
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

test("relationship view is forced to graph (network) or table — kanban rejected", () => {
  const bp = blueprint({
    entities: [{ nodeType: "relationship", label: "Relationship", fields: [] }],
    views: [{ entity: "relationship", kind: "kanban" }],
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

test("relationship view accepts network (graph)", () => {
  const bp = blueprint({
    entities: [{ nodeType: "relationship", label: "Relationship", fields: [] }],
    views: [{ entity: "relationship", kind: "network" }],
  });
  const compiled = compileBlueprint(bp, [...REGISTRY]);
  assert.equal(compiled.viewConfigs[0]?.kind, "network");
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
