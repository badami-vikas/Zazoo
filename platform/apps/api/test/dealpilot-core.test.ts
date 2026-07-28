import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { InMemorySourceCredentialVault } from "@bridge/dealpilot";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_ORGANIZATION } from "../src/wiring.js";

function runContext(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(6);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function buildTestWiring() {
  return buildWiring({ dealPilotCredentialVault: new InMemorySourceCredentialVault() });
}

test("Deal triage signals round-trip through createDeal/records/updateDeal (ADR-155)", async () => {
  const wiring = await buildTestWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: runContext(),
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
      reauthenticatedAt: Date.now(),
    });

    // The manifest exposes the new signal columns on the Deals page.
    const module = await caller.dealpilot.module({ organizationId: PILOT_ORGANIZATION });
    const dealColumns = module.pages.find((page) => page.id === "deals")!.columns.map((c) => c.id);
    for (const id of ["rag", "fitScore", "thesisTag", "sourceChannel", "evidenceScore", "p0Flags"]) {
      assert.ok(dealColumns.includes(id), `deals manifest should expose "${id}"`);
    }

    const created = await caller.dealpilot.createDeal({
      organizationId: PILOT_ORGANIZATION,
      company: "test_fixture_signals",
      revenue: 14_200_000,
      ebitda: 4_100_000,
      askingPrice: 42_000_000,
      rag: "green",
      fitScore: 87,
      evidenceScore: 78,
      p0Flags: 1,
      thesisTag: "B2B SaaS",
      sourceChannel: "Proprietary",
    });
    assert.equal(created.rag, "green");
    assert.equal(created.fitScore, 87);
    assert.equal(created.evidenceScore, 78);
    assert.equal(created.p0Flags, 1);
    assert.equal(created.thesisTag, "B2B SaaS");
    assert.equal(created.sourceChannel, "Proprietary");

    // Read path returns the signals so the table/stat cards can render them.
    const page = await caller.dealpilot.records({
      organizationId: PILOT_ORGANIZATION,
      page: "deals",
      limit: 50,
      offset: 0,
    });
    const row = page.items.find((item) => item.id === created.id);
    assert.ok(row && row.kind === "deal");
    assert.equal(row.fitScore, 87);
    assert.equal(row.rag, "green");

    // A human edit persists and does not disturb untouched signals.
    const updated = await caller.dealpilot.updateDeal({
      organizationId: PILOT_ORGANIZATION,
      id: created.id,
      rag: "yellow",
      p0Flags: 3,
    });
    assert.equal(updated.rag, "yellow");
    assert.equal(updated.p0Flags, 3);
    assert.equal(updated.fitScore, 87);
    assert.equal(updated.evidenceScore, 78);

    // Bounds are enforced (fit/evidence are 0..100).
    await assert.rejects(
      caller.dealpilot.createDeal({
        organizationId: PILOT_ORGANIZATION,
        company: "test_fixture_out_of_range",
        fitScore: 150,
      }),
    );
  } finally {
    await wiring.close();
  }
});

test("DealPilot creates its three real Record types and applies reviewed Thesis-to-Source discovery", async () => {
  const wiring = await buildTestWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: runContext(),
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
      reauthenticatedAt: Date.now(),
    });
    const module = await caller.dealpilot.module({ organizationId: PILOT_ORGANIZATION });
    assert.deepEqual(module.pages.map((page) => page.name), ["Deals", "Sources", "Theses"]);

    const source = await caller.dealpilot.createSource({
      organizationId: PILOT_ORGANIZATION,
      name: "test_fixture_source",
      link: "https://example.invalid/source",
      connectionType: "account",
      spendCap: 20,
      rightsAttested: true,
      userId: "test_fixture_user",
      password: "test_fixture_secret",
    });
    const created = await caller.dealpilot.createThesis({
      organizationId: PILOT_ORGANIZATION,
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
      nonMember.action.listPending({ organizationId: PILOT_ORGANIZATION, limit: 50, offset: 0 }),
      /not approved for the pilot Organization/,
    );
    await assert.rejects(
      nonMember.action.decide({ proposalId: created.discovery.id, decision: "approve" }),
      /not approved for the pilot Organization/,
    );
    assert.equal((await caller.dealpilot.records({
      organizationId: PILOT_ORGANIZATION,
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
      organizationId: PILOT_ORGANIZATION,
      kind: "source",
      id: source.id,
    });
    assert.equal(sourceDetail.record.kind, "source");
    assert.equal(sourceDetail.relatedRecords.some((record) => record.kind === "thesis"), true);
    assert.equal("credentialProjection" in sourceDetail, true);
    assert.equal(JSON.stringify(sourceDetail).includes("test_fixture_secret"), false);
    await assert.rejects(
      caller.dealpilot.discoverDeals({
        organizationId: PILOT_ORGANIZATION,
        sourceId: source.id,
      }),
      /supports Deal discovery only for an authorized BizBuySell email-alert Source/,
    );

    await wiring.dealpilot.store.quarantineCapture(PILOT_ORGANIZATION, source.id, {
      captureId: "test_fixture_capture",
      moduleId: "dealpilot",
      sourceConnectorId: "test_fixture_connector",
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
    const concurrentCommits = await Promise.allSettled([
      caller.dealpilot.commit({
        organizationId: PILOT_ORGANIZATION,
        captureId: "test_fixture_capture",
      }),
      caller.dealpilot.commit({
        organizationId: PILOT_ORGANIZATION,
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
      organizationId: PILOT_ORGANIZATION,
      page: "deals",
      limit: 50,
      offset: 0,
    });
    assert.equal(deals.total, 1);
    await wiring.dealpilot.store.quarantineCapture(PILOT_ORGANIZATION, source.id, {
      captureId: "test_fixture_capture_update",
      moduleId: "dealpilot",
      sourceConnectorId: "test_fixture_connector",
      tier: "email",
      query: { kind: "company", hints: { sourceId: source.id } },
      payload: {
        name: "test_fixture_company",
        revenue: 2_000_000,
        sde: 300_000,
        askPrice: 1_100_000,
      },
      confidence: 0.95,
      costUnits: 0,
      capturedAt: "2026-07-16T01:00:00.000Z",
      trustOrigin: "untrusted_external",
    });
    const updatedCommit = await caller.dealpilot.commit({
      organizationId: PILOT_ORGANIZATION,
      captureId: "test_fixture_capture_update",
    });
    assert.equal(updatedCommit.committed, true);
    const updatedDeals = await caller.dealpilot.records({
      organizationId: PILOT_ORGANIZATION,
      page: "deals",
      limit: 50,
      offset: 0,
    });
    assert.equal(updatedDeals.total, 1);
    const deal = updatedDeals.items[0]!;
    assert.equal(deal.kind === "deal" ? deal.revenue : null, 2_000_000);
    assert.equal(deal.kind === "deal" ? deal.askingPrice : null, 1_100_000);
    const dealDetail = await caller.dealpilot.detail({
      organizationId: PILOT_ORGANIZATION,
      kind: "deal",
      id: deal.id,
    });
    assert.deepEqual(new Set(dealDetail.relatedRecords.map((record) => record.kind)), new Set(["source", "thesis"]));

    await wiring.dealpilot.store.quarantineCapture(PILOT_ORGANIZATION, source.id, {
      captureId: "test_fixture_capture_restart",
      moduleId: "dealpilot",
      sourceConnectorId: "test_fixture_connector",
      tier: "email",
      query: { kind: "company", hints: { sourceId: source.id } },
      payload: { name: "test_fixture_restart_company" },
      confidence: 0.9,
      costUnits: 0,
      capturedAt: "2026-07-16T02:00:00.000Z",
      trustOrigin: "untrusted_external",
    });
    const commitCapture = wiring.dealpilot.store.commitCapture.bind(
      wiring.dealpilot.store,
    );
    wiring.dealpilot.store.commitCapture = async () => {
      throw new Error("test_fixture_process_stopped_after_governed_proposal");
    };
    try {
      await assert.rejects(
        caller.dealpilot.commit({
          organizationId: PILOT_ORGANIZATION,
          captureId: "test_fixture_capture_restart",
        }),
        /process_stopped_after_governed_proposal/,
      );
    } finally {
      wiring.dealpilot.store.commitCapture = commitCapture;
    }
    const recoveredCommit = await caller.dealpilot.commit({
      organizationId: PILOT_ORGANIZATION,
      captureId: "test_fixture_capture_restart",
    });
    assert.equal(recoveredCommit.committed, true);
    assert.equal(
      recoveredCommit.committed &&
        recoveredCommit.proposal &&
        "recovered" in recoveredCommit.proposal
        ? recoveredCommit.proposal.recovered
        : false,
      true,
    );

    assert.equal(
      (await caller.dealpilot.captures({ organizationId: PILOT_ORGANIZATION })).items.length,
      0,
    );
    assert.deepEqual(
      await caller.dealpilot.commit({
        organizationId: PILOT_ORGANIZATION,
        captureId: "test_fixture_capture",
      }),
      { committed: false, alreadyCommitted: true },
    );
  } finally {
    await wiring.close();
  }
});

test("DealPilot credential access requires re-authentication and records value-free audit events", async () => {
  const wiring = await buildTestWiring();
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
      organizationId: PILOT_ORGANIZATION,
      name: "test_fixture_source",
      link: "https://example.invalid/source",
      connectionType: "account",
      spendCap: 0,
      rightsAttested: true,
      password: "test_fixture_secret",
    });

    await assert.rejects(
      caller.dealpilot.accessCredential({
        organizationId: PILOT_ORGANIZATION,
        sourceId: source.id,
        token: "test_fixture_missing_reauth",
        field: "password",
        action: "reveal",
      }),
      /re-authentication session is required/,
    );
    const session = await caller.dealpilot.reauthenticateCredential({
      organizationId: PILOT_ORGANIZATION,
      sourceId: source.id,
    });
    const revealed = await caller.dealpilot.accessCredential({
      organizationId: PILOT_ORGANIZATION,
      sourceId: source.id,
      token: session.token,
      field: "password",
      action: "reveal",
    });
    assert.equal(revealed.value, "test_fixture_secret");
    const revoked = await caller.dealpilot.clearCredential({
      organizationId: PILOT_ORGANIZATION,
      sourceId: source.id,
      token: session.token,
    });
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.credentialProjection.password.state, "unavailable");
    await assert.rejects(
      caller.dealpilot.accessCredential({
        organizationId: PILOT_ORGANIZATION,
        sourceId: source.id,
        token: session.token,
        field: "password",
        action: "reveal",
      }),
      /not authorized/,
    );
    const afterRevoke = await caller.dealpilot.detail({
      organizationId: PILOT_ORGANIZATION,
      kind: "source",
      id: source.id,
    });
    assert.equal(
      "credentialProjection" in afterRevoke
        ? afterRevoke.credentialProjection?.password.state
        : null,
      "unavailable",
    );
    const auditEvents = await wiring.dealpilot.store.credentialAuditEvents(
      PILOT_ORGANIZATION,
    );
    assert.deepEqual(
      auditEvents.map((event) => event.action),
      ["reveal", "revoke"],
    );
    assert.equal(JSON.stringify(auditEvents).includes("test_fixture_secret"), false);
  } finally {
    await wiring.close();
  }
});

test("Deal discovery fails closed before connector access when Source rights are unattested", async () => {
  const wiring = await buildTestWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: runContext(),
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
    });
    const source = await caller.dealpilot.createSource({
      organizationId: PILOT_ORGANIZATION,
      name: "test_fixture_source",
      link: "https://example.invalid/source",
      connectionType: "url",
      spendCap: 0,
      rightsAttested: false,
    });
    await assert.rejects(
      caller.dealpilot.discoverDeals({
        organizationId: PILOT_ORGANIZATION,
        sourceId: source.id,
      }),
      /attest data rights/,
    );
    await assert.rejects(
      () =>
        Reflect.apply(caller.action.propose, caller.action, [{
          organizationId: PILOT_ORGANIZATION,
          actor: { type: "user", id: PILOT_USER, plane: "cloud" },
          action: "read",
          resourceType: "external:fetch",
          inputs: { organizationId: PILOT_ORGANIZATION, sourceId: source.id },
          skill: "dealpilot.source",
        }]),
      /stageMutation|invalid literal/i,
    );
  } finally {
    await wiring.close();
  }
});

test("Deal discovery derives spend server-side and blocks before connector access when the cap is exhausted", async () => {
  const wiring = await buildTestWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: runContext(),
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
    });
    const source = await caller.dealpilot.createSource({
      organizationId: PILOT_ORGANIZATION,
      name: "test_fixture_bizbuysell_alerts",
      link: "https://www.bizbuysell.com/",
      connectionType: "email_alert",
      spendCap: 0,
      rightsAttested: true,
    });
    await assert.rejects(
      caller.dealpilot.discoverDeals({
        organizationId: PILOT_ORGANIZATION,
        sourceId: source.id,
      }),
      /exceeds the remaining Source cap/,
    );
  } finally {
    await wiring.close();
  }
});

test("DealPilot rejects authenticated non-members before Records or credentials are exposed", async () => {
  const wiring = await buildTestWiring();
  try {
    const attacker = appRouter.createCaller({
      wiring,
      run: runContext(),
      identity: { type: "user", id: "f0000000-0000-4000-a000-000000000099" },
      authenticated: true,
      verifying: true,
      reauthenticatedAt: Date.now(),
    });
    await assert.rejects(
      attacker.dealpilot.module({ organizationId: PILOT_ORGANIZATION }),
      /not approved for the pilot Organization/,
    );
    await assert.rejects(
      attacker.dealpilot.records({
        organizationId: PILOT_ORGANIZATION,
        page: "sources",
        limit: 50,
        offset: 0,
      }),
      /not approved for the pilot Organization/,
    );
  } finally {
    await wiring.close();
  }
});

test("DealPilot rejects unauthenticated reads whenever persistence is enabled", async () => {
  const wiring = await buildTestWiring();
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
        organizationId: PILOT_ORGANIZATION,
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

test("edited discovery approval cannot attach an unattested Source", async () => {
  const wiring = await buildTestWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: runContext(),
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
    });
    const blockedSource = await caller.dealpilot.createSource({
      organizationId: PILOT_ORGANIZATION,
      name: "test_fixture_unattested_source",
      link: "https://www.bizbuysell.com/",
      connectionType: "email_alert",
      spendCap: 10,
      rightsAttested: false,
    });
    const created = await caller.dealpilot.createThesis({
      organizationId: PILOT_ORGANIZATION,
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
          organizationId: PILOT_ORGANIZATION,
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
      (await wiring.dealpilot.store.relations(PILOT_ORGANIZATION, blockedSource.id)).length,
      0,
    );
  } finally {
    await wiring.close();
  }
});

test("concurrent distinct captures for one company materialize one Deal", async () => {
  const wiring = await buildTestWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: runContext(),
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
    });
    const source = await caller.dealpilot.createSource({
      organizationId: PILOT_ORGANIZATION,
      name: "test_fixture_concurrent_source",
      link: "https://example.invalid/concurrent-source",
      connectionType: "email_alert",
      spendCap: 0,
      rightsAttested: true,
    });
    for (const [captureId, company, revenue] of [
      ["test_fixture_concurrent_a", "test_fixture_concurrent_company", 1_000_000],
      ["test_fixture_concurrent_b", "test_fixture_concurrent_company_holdings", 1_100_000],
    ] as const) {
      await wiring.dealpilot.store.quarantineCapture(PILOT_ORGANIZATION, source.id, {
        captureId,
        moduleId: "dealpilot",
        sourceConnectorId: "test_fixture_connector",
        tier: "email",
        query: { kind: "company", hints: {} },
        payload: {
          name: company,
          domain: "test-fixture-concurrent.example",
          revenue,
        },
        confidence: 0.9,
        costUnits: 0,
        capturedAt: "2026-07-16T00:00:00.000Z",
        trustOrigin: "untrusted_external",
      });
    }

    const commits = await Promise.all([
      caller.dealpilot.commit({
        organizationId: PILOT_ORGANIZATION,
        captureId: "test_fixture_concurrent_a",
      }),
      caller.dealpilot.commit({
        organizationId: PILOT_ORGANIZATION,
        captureId: "test_fixture_concurrent_b",
      }),
    ]);
    assert.ok(commits.every((commit) => commit.committed));
    assert.equal(
      (await caller.dealpilot.records({
        organizationId: PILOT_ORGANIZATION,
        page: "deals",
        limit: 50,
        offset: 0,
      })).total,
      1,
    );
  } finally {
    await wiring.close();
  }
});
