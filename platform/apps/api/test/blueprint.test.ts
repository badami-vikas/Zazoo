/**
 * organization.blueprint.{get,propose,getById,activate} — P1 Organization Generator
 * (ADR-017) + ADR-023/ADR-024's `getById` addition. Mirrors modules.test.ts's
 * harness (buildWiring() + appRouter.createCaller).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    // Real seeded user id (not a test_fixture_-prefixed string) — organization_definitions.created_by
    // is a real FK to users, so an arbitrary caller id would violate it.
    identity: { type: "user", id: PILOT_USER },
    authenticated: true, // SEC-1: in-process test caller is a trusted, authenticated actor
    verifying: false,
  });
}

function dummyBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    vocabulary: {},
    entities: [
      {
        nodeType: "record",
        label: "Record",
        fields: [{ id: "name", label: "Name", kind: "text" as const }],
      },
    ],
    views: [{ entity: "record", kind: "table" as const }],
    capabilities: [],
    ...overrides,
  };
}

function locationBlueprint() {
  return dummyBlueprint({
    entities: [{
      nodeType: "record",
      label: "Record",
      fields: [
        { id: "name", label: "Name", kind: "text" as const },
        { id: "where", label: "Where", kind: "location" as const },
      ],
    }],
    views: [{
      entity: "record",
      kind: "map" as const,
      config: { locationBy: "where" },
    }],
  });
}

test("organization.blueprint.get: returns null definition for a organization with no active blueprint yet (no dummy fallback)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { definition } = await caller.organization.blueprint.get({ organizationId: PILOT_ORGANIZATION });
    assert.equal(definition, null);
  } finally {
    await wiring.close();
  }
});

test("organization.blueprint.propose: creates a draft, rejects an invalid blueprint before persisting", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { definition } = await caller.organization.blueprint.propose({
      organizationId: PILOT_ORGANIZATION,
      blueprint: dummyBlueprint(),
    });

    assert.equal(definition.status, "draft");
    assert.equal(definition.organizationId, PILOT_ORGANIZATION);

    await assert.rejects(
      () =>
        caller.organization.blueprint.propose({
          organizationId: PILOT_ORGANIZATION,
          blueprint: dummyBlueprint({ entities: [{ nodeType: "not_a_registered_type", label: "Nope", fields: [] }] }),
        }),
      /BAD_REQUEST|not a registered node type/,
    );
  } finally {
    await wiring.close();
  }
});

test("organization.blueprint.propose: round-trips a location field through API and persistent store", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { definition: draft } = await caller.organization.blueprint.propose({
      organizationId: PILOT_ORGANIZATION,
      blueprint: locationBlueprint(),
    });
    const { definition } = await caller.organization.blueprint.getById({
      organizationId: PILOT_ORGANIZATION,
      definitionId: draft.id,
    });
    assert.equal(definition.blueprint.entities[0]?.fields[1]?.kind, "location");
    assert.equal(definition.blueprint.views[0]?.config?.locationBy, "where");
  } finally {
    await wiring.close();
  }
});

test("organization.blueprint.getById: returns a DRAFT definition by id, identity-scoped to the caller's organization (ADR-023/ADR-024)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { definition: draft } = await caller.organization.blueprint.propose({
      organizationId: PILOT_ORGANIZATION,
      blueprint: dummyBlueprint(),
    });

    const { definition } = await caller.organization.blueprint.getById({
      organizationId: PILOT_ORGANIZATION,
      definitionId: draft.id,
    });
    assert.equal(definition.id, draft.id);
    assert.equal(definition.status, "draft");
  } finally {
    await wiring.close();
  }
});

test("organization.blueprint.getById: 404s on an unknown definitionId", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () => caller.organization.blueprint.getById({ organizationId: PILOT_ORGANIZATION, definitionId: "00000000-0000-4000-8000-000000000000" }),
      /unknown organization_definition/,
    );
  } finally {
    await wiring.close();
  }
});

test("organization.blueprint.getById: still resolves an ARCHIVED definition (not just draft/active) — the whole point of the endpoint", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { definition: v1 } = await caller.organization.blueprint.propose({
      organizationId: PILOT_ORGANIZATION,
      blueprint: dummyBlueprint(),
    });
    await caller.organization.blueprint.activate({ organizationId: PILOT_ORGANIZATION, definitionId: v1.id });

    const { definition: v2 } = await caller.organization.blueprint.propose({
      organizationId: PILOT_ORGANIZATION,
      blueprint: dummyBlueprint({ vocabulary: { Record: "Deal" } }),
    });
    await caller.organization.blueprint.activate({ organizationId: PILOT_ORGANIZATION, definitionId: v2.id });

    // v1 is now archived (v2 activation supersedes it) — getById must still find it.
    const { definition } = await caller.organization.blueprint.getById({ organizationId: PILOT_ORGANIZATION, definitionId: v1.id });
    assert.equal(definition.id, v1.id);
    assert.equal(definition.status, "archived");
  } finally {
    await wiring.close();
  }
});
