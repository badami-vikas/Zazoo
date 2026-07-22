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

test("SECURITY: organization.blueprint.activate — authorized pilot-user activation still succeeds and mutates state", async () => {
  const wiring = await buildWiring();
  try {
    // `caller` here is already the seeded PILOT_USER (see makeCaller's comment) —
    // `seedGovernance`'s direct grants now include organization_definition:approve
    // for this identity, so its action:"approve" proposal resolves "applied" and
    // the activation mutation actually runs (proving the fix's Part 2 grant did
    // not just lock legitimate approvals out).
    const caller = await makeCaller(wiring);
    const { definition: draft } = await caller.organization.blueprint.propose({
      organizationId: PILOT_ORGANIZATION,
      blueprint: dummyBlueprint(),
    });
    assert.equal(draft.status, "draft");

    const result = await caller.organization.blueprint.activate({
      organizationId: PILOT_ORGANIZATION,
      definitionId: draft.id,
    });

    assert.equal(result.activated, true, "an authorized activation must actually activate");
    assert.equal(result.definition.status, "active");

    const { definition: reloaded } = await caller.organization.blueprint.getById({
      organizationId: PILOT_ORGANIZATION,
      definitionId: draft.id,
    });
    assert.equal(reloaded.status, "active", "state genuinely advanced in the store, not just the response");
  } finally {
    await wiring.close();
  }
});

test("SECURITY: organization.blueprint.activate throws FORBIDDEN for a caller with no organization_definition:approve grant, and does NOT mutate state", async () => {
  const wiring = await buildWiring();
  try {
    // Propose as the authorized pilot user (organization_definitions.created_by
    // is a real FK to users — see makeCaller's comment), then attempt to
    // activate as a DIFFERENT, ungranted identity. Before the hard-stop guard,
    // this fell through into archiving/activating anyway (docs/BUGS.md); it
    // must now throw before ever reaching that mutation.
    const authorizedCaller = await makeCaller(wiring);
    const { definition: draft } = await authorizedCaller.organization.blueprint.propose({
      organizationId: PILOT_ORGANIZATION,
      blueprint: dummyBlueprint(),
    });

    const unauthorizedCaller = await appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "user", id: "test_fixture_blueprint_unauthorized_user" },
      authenticated: true,
      verifying: false,
    });

    await assert.rejects(
      () =>
        unauthorizedCaller.organization.blueprint.activate({
          organizationId: PILOT_ORGANIZATION,
          definitionId: draft.id,
        }),
      (err: unknown) => {
        assert.match(String((err as { message?: string })?.message ?? err), /FORBIDDEN|authority|not authorized/i);
        return true;
      },
    );

    const { definition: reloaded } = await authorizedCaller.organization.blueprint.getById({
      organizationId: PILOT_ORGANIZATION,
      definitionId: draft.id,
    });
    assert.equal(reloaded.status, "draft", "an unauthorized activate must leave the definition status unchanged");
  } finally {
    await wiring.close();
  }
});

test("SECURITY: organization.blueprint.activate throws FORBIDDEN for an Agent actor (agent-floor), and does NOT mutate state", async () => {
  const wiring = await buildWiring();
  try {
    const authorizedCaller = await makeCaller(wiring);
    const { definition: draft } = await authorizedCaller.organization.blueprint.propose({
      organizationId: PILOT_ORGANIZATION,
      blueprint: dummyBlueprint(),
    });

    const agentCaller = await appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "agent", id: "test_fixture_blueprint_agent" },
      authenticated: true,
      verifying: false,
    });

    await assert.rejects(() =>
      agentCaller.organization.blueprint.activate({
        organizationId: PILOT_ORGANIZATION,
        definitionId: draft.id,
      }),
    );

    const { definition: reloaded } = await authorizedCaller.organization.blueprint.getById({
      organizationId: PILOT_ORGANIZATION,
      definitionId: draft.id,
    });
    assert.equal(reloaded.status, "draft", "an agent activate attempt must leave the definition status unchanged");
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
