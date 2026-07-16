import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_WORKSPACE } from "../src/wiring.js";

function runContext(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(6);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

test("DealPilot creates its three real Record types and applies reviewed Thesis-to-Source discovery", async () => {
  const wiring = await buildWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: runContext(),
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
      reauthenticatedAt: Date.now(),
    });
    const module = await caller.dealpilot.module({ workspaceId: PILOT_WORKSPACE });
    assert.deepEqual(module.pages.map((page) => page.name), ["Deals", "Sources", "Theses"]);

    const source = await caller.dealpilot.createSource({
      workspaceId: PILOT_WORKSPACE,
      name: "test_fixture_source",
      link: "https://example.invalid/source",
      connectionType: "account",
      spendCap: 20,
      rightsAttested: true,
      userId: "test_fixture_user",
      password: "test_fixture_secret",
    });
    const created = await caller.dealpilot.createThesis({
      workspaceId: PILOT_WORKSPACE,
      name: "test_fixture_thesis",
      focus: "test_fixture_focus",
      criteria: [],
      exclusions: [],
    });
    assert.equal(created.discovery.status, "pending_review");
    const nonMember = appRouter.createCaller({
      wiring,
      run: runContext(),
      identity: { type: "user", id: "f0000000-0000-4000-a000-000000000098" },
      authenticated: true,
      verifying: true,
    });
    await assert.rejects(
      nonMember.action.listPending({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 }),
      /is not a member/,
    );
    await assert.rejects(
      nonMember.action.decide({ proposalId: created.discovery.id, decision: "approve" }),
      /is not a member/,
    );
    assert.equal((await caller.dealpilot.records({
      workspaceId: PILOT_WORKSPACE,
      page: "theses",
      limit: 50,
      offset: 0,
    })).total, 1);

    const decided = await caller.action.decide({
      proposalId: created.discovery.id,
      decision: "approve",
    });
    assert.equal(decided.dealPilotEffects.length, 1);

    const sourceDetail = await caller.dealpilot.detail({
      workspaceId: PILOT_WORKSPACE,
      kind: "source",
      id: source.id,
    });
    assert.equal(sourceDetail.record.kind, "source");
    assert.equal(sourceDetail.relatedRecords.some((record) => record.kind === "thesis"), true);
    assert.equal("credentialProjection" in sourceDetail, true);
    assert.equal(JSON.stringify(sourceDetail).includes("test_fixture_secret"), false);
    await assert.rejects(
      caller.dealpilot.discoverDeals({
        workspaceId: PILOT_WORKSPACE,
        sourceId: source.id,
      }),
      /supports Deal discovery only for an authorized BizBuySell email-alert Source/,
    );

    await wiring.dealpilot.captures.put({
      captureId: "test_fixture_capture",
      toolId: "dealpilot",
      sourceToolId: "test_fixture_connector",
      tier: "email",
      query: { kind: "company", hints: { sourceId: source.id } },
      payload: {
        name: "test_fixture_company",
        revenue: 1_000_000,
        sde: 250_000,
        askPrice: 900_000,
      },
      confidence: 0.9,
      costUnits: 0,
      capturedAt: "2026-07-16T00:00:00.000Z",
      trustOrigin: "untrusted_external",
    });
    wiring.dealpilot.captureSources.set("test_fixture_capture", source.id);
    const concurrentCommits = await Promise.allSettled([
      caller.dealpilot.commit({
        workspaceId: PILOT_WORKSPACE,
        captureId: "test_fixture_capture",
      }),
      caller.dealpilot.commit({
        workspaceId: PILOT_WORKSPACE,
        captureId: "test_fixture_capture",
      }),
    ]);
    const commitResults = concurrentCommits.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    assert.equal(commitResults.length, 2);
    assert.equal(commitResults.filter((result) => result.committed).length, 1);
    assert.equal(commitResults.filter((result) => !result.committed).length, 1);
    const applied = commitResults.find((result) => result.committed);
    assert.equal(applied && "proposal" in applied ? applied.proposal.status : null, "applied");
    const deals = await caller.dealpilot.records({
      workspaceId: PILOT_WORKSPACE,
      page: "deals",
      limit: 50,
      offset: 0,
    });
    assert.equal(deals.total, 1);
    const deal = deals.items[0]!;
    const dealDetail = await caller.dealpilot.detail({
      workspaceId: PILOT_WORKSPACE,
      kind: "deal",
      id: deal.id,
    });
    assert.deepEqual(new Set(dealDetail.relatedRecords.map((record) => record.kind)), new Set(["source", "thesis"]));
    assert.equal((await caller.dealpilot.captures({ workspaceId: PILOT_WORKSPACE })).length, 0);
    assert.deepEqual(
      await caller.dealpilot.commit({
        workspaceId: PILOT_WORKSPACE,
        captureId: "test_fixture_capture",
      }),
      { committed: false, alreadyCommitted: true },
    );
  } finally {
    await wiring.close();
  }
});

test("DealPilot credential access requires re-authentication and records value-free audit events", async () => {
  const wiring = await buildWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: runContext(),
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
      reauthenticatedAt: Date.now(),
    });
    const source = await caller.dealpilot.createSource({
      workspaceId: PILOT_WORKSPACE,
      name: "test_fixture_source",
      link: "https://example.invalid/source",
      connectionType: "account",
      spendCap: 0,
      rightsAttested: true,
      password: "test_fixture_secret",
    });

    await assert.rejects(
      caller.dealpilot.accessCredential({
        workspaceId: PILOT_WORKSPACE,
        sourceId: source.id,
        token: "test_fixture_missing_reauth",
        field: "password",
        action: "reveal",
      }),
      /re-authentication session is required/,
    );
    const session = await caller.dealpilot.reauthenticateCredential({
      workspaceId: PILOT_WORKSPACE,
      sourceId: source.id,
    });
    const revealed = await caller.dealpilot.accessCredential({
      workspaceId: PILOT_WORKSPACE,
      sourceId: source.id,
      token: session.token,
      field: "password",
      action: "reveal",
    });
    assert.equal(revealed.value, "test_fixture_secret");
    assert.equal(wiring.dealpilot.credentialAudit.events.length, 1);
    assert.equal(JSON.stringify(wiring.dealpilot.credentialAudit.events).includes("test_fixture_secret"), false);
  } finally {
    await wiring.close();
  }
});

test("Deal discovery fails closed before connector access when Source rights are unattested", async () => {
  const wiring = await buildWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: runContext(),
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
    });

    test("Deal discovery derives spend server-side and blocks before connector access when the cap is exhausted", async () => {
      const wiring = await buildWiring();
      try {
        const caller = appRouter.createCaller({
          wiring,
          run: runContext(),
          identity: { type: "user", id: PILOT_USER },
          authenticated: true,
          verifying: false,
        });
        const source = await caller.dealpilot.createSource({
          workspaceId: PILOT_WORKSPACE,
          name: "test_fixture_bizbuysell_alerts",
          link: "https://www.bizbuysell.com/",
          connectionType: "email_alert",
          spendCap: 0,
          rightsAttested: true,
        });
        await assert.rejects(
          caller.dealpilot.discoverDeals({
            workspaceId: PILOT_WORKSPACE,
            sourceId: source.id,
          }),
          /exceeds the remaining Source cap/,
        );
      } finally {
        await wiring.close();
      }
    });

    test("DealPilot rejects authenticated non-members before Records or credentials are exposed", async () => {
      const wiring = await buildWiring();
      try {
        const attacker = appRouter.createCaller({
          wiring,
          run: runContext(),
          identity: { type: "user", id: "f0000000-0000-4000-a000-000000000099" },
          authenticated: true,
          verifying: true,
          reauthenticatedAt: Date.now(),
        });

        test("DealPilot rejects unauthenticated reads whenever persistence is enabled", async () => {
          const wiring = await buildWiring();
          try {
            wiring.persistent = true;
            const anonymous = appRouter.createCaller({
              wiring,
              run: runContext(),
              identity: { type: "user", id: PILOT_USER },
              authenticated: false,
              verifying: false,
            });
            await assert.rejects(
              anonymous.dealpilot.records({
                workspaceId: PILOT_WORKSPACE,
                page: "deals",
                limit: 50,
                offset: 0,
              }),
              /authentication required/,
            );
          } finally {
            await wiring.close();
          }
        });
        await assert.rejects(
          attacker.dealpilot.module({ workspaceId: PILOT_WORKSPACE }),
          /is not a member/,
        );
        await assert.rejects(
          attacker.dealpilot.records({
            workspaceId: PILOT_WORKSPACE,
            page: "sources",
            limit: 50,
            offset: 0,
          }),
          /is not a member/,
        );
      } finally {
        await wiring.close();
      }
    });

    test("edited discovery approval cannot attach an unattested Source", async () => {
      const wiring = await buildWiring();
      try {
        const caller = appRouter.createCaller({
          wiring,
          run: runContext(),
          identity: { type: "user", id: PILOT_USER },
          authenticated: true,
          verifying: false,
        });
        const blockedSource = await caller.dealpilot.createSource({
          workspaceId: PILOT_WORKSPACE,
          name: "test_fixture_unattested_source",
          link: "https://www.bizbuysell.com/",
          connectionType: "email_alert",
          spendCap: 10,
          rightsAttested: false,
        });
        const created = await caller.dealpilot.createThesis({
          workspaceId: PILOT_WORKSPACE,
          name: "test_fixture_thesis",
          focus: "test_fixture_focus",
          criteria: [],
          exclusions: [],
        });
        await assert.rejects(
          caller.action.decide({
            proposalId: created.discovery.id,
            decision: "edit",
            editedOutput: {
              kind: "thesis_source_discovery",
              workspaceId: PILOT_WORKSPACE,
              thesisId: created.thesis.id,
              relations: [{
                sourceId: blockedSource.id,
                thesisId: created.thesis.id,
                confidence: 1,
                provenance: "authorized_source_inventory",
                reason: "Authorized Source inventory candidate; Thesis fit is not scored",
              }],
            },
          }),
          /no longer authorized/,
        );
        assert.equal(await wiring.ledger.decisionFor(created.discovery.id), null);
        assert.equal(
          (await wiring.dealpilot.store.relations(PILOT_WORKSPACE, blockedSource.id)).length,
          0,
        );
      } finally {
        await wiring.close();
      }
    });
    const source = await caller.dealpilot.createSource({
      workspaceId: PILOT_WORKSPACE,
      name: "test_fixture_source",
      link: "https://example.invalid/source",
      connectionType: "url",
      spendCap: 0,
      rightsAttested: false,
    });
    await assert.rejects(
      caller.dealpilot.discoverDeals({
        workspaceId: PILOT_WORKSPACE,
        sourceId: source.id,
      }),
      /attest data rights/,
    );
    await assert.rejects(
      caller.action.propose({
        workspaceId: PILOT_WORKSPACE,
        actor: { type: "user", id: PILOT_USER, plane: "cloud" },
        action: "read",
        resourceType: "external:fetch",
        inputs: { workspaceId: PILOT_WORKSPACE, sourceId: source.id },
        skill: "dealpilot.source",
      }),
      /attest data rights/,
    );
  } finally {
    await wiring.close();
  }
});
