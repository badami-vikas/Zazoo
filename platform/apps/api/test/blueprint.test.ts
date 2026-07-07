/**
 * workspace.blueprint.{get,propose,getById,activate} — P1 Workspace Generator
 * (ADR-017) + ADR-023/ADR-024's `getById` addition. Mirrors packages.test.ts's
 * harness (buildWiring() + appRouter.createCaller).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_WORKSPACE, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    // Real seeded user id (not a dummy_-prefixed string) — workspace_definitions.created_by
    // is a real FK to users, so an arbitrary caller id would violate it.
    identity: { type: "user", id: PILOT_USER },
  });
}

function dummyBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    vocabulary: {},
    entities: [
      {
        nodeType: "initiative",
        label: "Initiative",
        fields: [{ id: "name", label: "Name", kind: "text" as const }],
      },
    ],
    views: [{ entity: "initiative", kind: "table" as const }],
    capabilities: [],
    ...overrides,
  };
}

test("workspace.blueprint.get: returns null definition for a workspace with no active blueprint yet (no dummy fallback)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { definition } = await caller.workspace.blueprint.get({ workspaceId: PILOT_WORKSPACE });
    assert.equal(definition, null);
  } finally {
    await wiring.close();
  }
});

test("workspace.blueprint.propose: creates a draft, rejects an invalid blueprint before persisting", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { definition } = await caller.workspace.blueprint.propose({
      workspaceId: PILOT_WORKSPACE,
      blueprint: dummyBlueprint(),
    });
    assert.equal(definition.status, "draft");
    assert.equal(definition.workspaceId, PILOT_WORKSPACE);

    await assert.rejects(
      () =>
        caller.workspace.blueprint.propose({
          workspaceId: PILOT_WORKSPACE,
          blueprint: dummyBlueprint({ entities: [{ nodeType: "not_a_registered_type", label: "Nope", fields: [] }] }),
        }),
      /BAD_REQUEST|not a registered node type/,
    );
  } finally {
    await wiring.close();
  }
});

test("workspace.blueprint.getById: returns a DRAFT definition by id, identity-scoped to the caller's workspace (ADR-023/ADR-024)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { definition: draft } = await caller.workspace.blueprint.propose({
      workspaceId: PILOT_WORKSPACE,
      blueprint: dummyBlueprint(),
    });

    const { definition } = await caller.workspace.blueprint.getById({
      workspaceId: PILOT_WORKSPACE,
      definitionId: draft.id,
    });
    assert.equal(definition.id, draft.id);
    assert.equal(definition.status, "draft");
  } finally {
    await wiring.close();
  }
});

test("workspace.blueprint.getById: 404s on an unknown definitionId", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () => caller.workspace.blueprint.getById({ workspaceId: PILOT_WORKSPACE, definitionId: "00000000-0000-4000-8000-000000000000" }),
      /unknown workspace_definition/,
    );
  } finally {
    await wiring.close();
  }
});

test("workspace.blueprint.getById: still resolves an ARCHIVED definition (not just draft/active) — the whole point of the endpoint", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { definition: v1 } = await caller.workspace.blueprint.propose({
      workspaceId: PILOT_WORKSPACE,
      blueprint: dummyBlueprint(),
    });
    await caller.workspace.blueprint.activate({ workspaceId: PILOT_WORKSPACE, definitionId: v1.id });

    const { definition: v2 } = await caller.workspace.blueprint.propose({
      workspaceId: PILOT_WORKSPACE,
      blueprint: dummyBlueprint({ vocabulary: { Initiative: "Deal" } }),
    });
    await caller.workspace.blueprint.activate({ workspaceId: PILOT_WORKSPACE, definitionId: v2.id });

    // v1 is now archived (v2 activation supersedes it) — getById must still find it.
    const { definition } = await caller.workspace.blueprint.getById({ workspaceId: PILOT_WORKSPACE, definitionId: v1.id });
    assert.equal(definition.id, v1.id);
    assert.equal(definition.status, "archived");
  } finally {
    await wiring.close();
  }
});
