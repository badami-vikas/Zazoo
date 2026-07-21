/**
 * commons.{list,get,getVersion,installPropose,publishBuiltins} — CM0 wire:
 * commons.* tRPC over CommonsRegistry port (egg-commons-feature-roadmap §CM0).
 *
 * Test strategy: inject an in-memory CommonsRegistry mock so tests don't
 * require a running services/commons instance. The mock is swapped onto the
 * Wiring object after buildWiring() (the same wiring object the createCaller
 * context receives), so the procedures under test see it transparently.
 *
 * Pattern mirrors modules.test.ts (buildWiring + appRouter.createCaller).
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  canonicalizeManifest,
  parseModuleManifest,
  type CommonsProvenance,
  type RunCtx,
} from "@bridge/core";
import { DrizzleModuleStore } from "@bridge/db";
import type {
  CommonsListQuery,
  CommonsListResult,
  CommonsModuleDetail,
  CommonsModuleEntry,
  CommonsRegistry,
} from "@bridge/core";
import type { ModuleManifest } from "@bridge/core";
import {
  COMMONS_BUILT_IN_MODULES,
  LEARNING_RECOMMENDATION_SKILL_ID,
} from "../src/built-in-modules.js";
import { appRouter } from "../src/router.js";
import { buildWiring, LEARNING_AGENT, PILOT_USER, PILOT_ORGANIZATION, type Wiring } from "../src/wiring.js";
import { makeUnsignedCommonsEntry, TEST_COMMONS_SCAN } from "./commons-fixtures.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring, identityId = PILOT_USER) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: identityId },
    authenticated: true,
    verifying: false,
  });
}

/** Minimal valid ModuleManifest as the registry would serve it. */
function commonsManifest(overrides: Partial<{ name: string; version: string }> = {}): ModuleManifest {
  const name = overrides.name ?? "test-commons-pkg";
  const version = overrides.version ?? "1.0.0";
  return {
    name,
    version,
    kind: "organization_definition",
    summary: "Test Commons module",
    description: "Created by commons.test.ts — in-memory registry fixture.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      {
        id: `${name}.read`,
        name: `${name} read`,
        version,
        capabilityType: "skill",
        origin: "built_in",
        audience: "private",
        permissions: [{ resourceType: "person", action: "read", dataScope: "all", egress: false }],
        connectors: [],
        dependencies: [],
      },
    ],
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  };
}

function makeEntry(manifest: ModuleManifest, tags: string[] = []): CommonsModuleEntry {
  return makeUnsignedCommonsEntry(manifest, tags);
}

// ---------------------------------------------------------------------------
// In-memory CommonsRegistry mock — no crypto, no network, no running service.
// ---------------------------------------------------------------------------

class InMemoryTestCommonsRegistry implements CommonsRegistry {
  private readonly entries: Map<string, CommonsModuleEntry[]> = new Map();

  /** Seed the registry with entries for testing. */
  seed(entry: CommonsModuleEntry): this {
    const versions = this.entries.get(entry.name) ?? [];
    versions.push(entry);
    this.entries.set(entry.name, versions);
    return this;
  }

  async listAvailable(query: CommonsListQuery = {}): Promise<CommonsListResult> {
    let all: CommonsModuleEntry[] = [];
    for (const versions of this.entries.values()) {
      const latest = versions.at(-1);
      if (latest) all.push(latest);
    }
    if (query.kind !== undefined) all = all.filter((e) => e.kind === query.kind);
    if (query.tag !== undefined) all = all.filter((e) => e.tags.includes(query.tag!));
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 20;
    const page = all.slice(offset, offset + limit);
    return {
      items: page.map((e) => ({
        name: e.name,
        latestVersion: e.version,
        kind: e.kind,
        summary: e.summary,
        tags: e.tags,
        versionCount: (this.entries.get(e.name) ?? []).length,
        publishedAt: e.publishedAt,
      })),
      total: all.length,
      limit,
      offset,
    };
  }

  async get(name: string): Promise<CommonsModuleDetail | null> {
    const versions = this.entries.get(name);
    if (!versions || versions.length === 0) return null;
    const latest = versions.at(-1)!;
    return {
      name,
      latest,
      versions: versions.map((v) => ({ version: v.version, publishedAt: v.publishedAt })),
    };
  }

  async getVersion(name: string, version: string): Promise<CommonsModuleEntry | null> {
    return this.entries.get(name)?.find((e) => e.version === version) ?? null;
  }

  async publish(
    manifest: ModuleManifest,
    options: { tags?: string[]; provenance: CommonsProvenance; expectedContentHash?: string },
  ): Promise<{ name: string; version: string; contentHash: string }> {
    const existing = this.entries.get(manifest.name);
    if (existing?.some((e) => e.version === manifest.version)) {
      throw new Error(`commons: ${manifest.name}@${manifest.version} is already published`);
    }
    const entry = makeEntry(manifest, options.tags ?? []);
    this.seed({ ...entry, provenance: options.provenance });
    return { name: manifest.name, version: manifest.version, contentHash: entry.integrity.value };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("commons.list: returns modules from the registry (mock)", async () => {
  const wiring = await buildWiring();
  const mockRegistry = new InMemoryTestCommonsRegistry();
  mockRegistry.seed(makeEntry(commonsManifest({ name: "pkg-a", version: "1.0.0" }), ["tag-a"]));
  mockRegistry.seed(makeEntry(commonsManifest({ name: "pkg-b", version: "2.0.0" }), ["tag-b"]));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const result = await caller.commons.list({});
    assert.equal(result.total, 2);
    assert.equal(result.items.length, 2);
    const names = result.items.map((i) => i.name).sort();
    assert.deepEqual(names, ["pkg-a", "pkg-b"]);
  } finally {
    await wiring.close();
  }
});

test("commons.list: filters by kind", async () => {
  const wiring = await buildWiring();
  const mockRegistry = new InMemoryTestCommonsRegistry();
  const skillManifest: ModuleManifest = { ...commonsManifest({ name: "skill-pkg" }), kind: "organization_definition" };
  mockRegistry.seed(makeEntry(commonsManifest({ name: "ws-pkg" }), []));
  mockRegistry.seed(makeEntry(skillManifest, []));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const result = await caller.commons.list({ kind: "organization_definition" });
    assert.equal(result.total, 2); // both are organization_definition in this fixture
    assert.ok(result.items.every((i) => i.kind === "organization_definition"));
  } finally {
    await wiring.close();
  }
});

test("commons.get: returns module detail for known name", async () => {
  const wiring = await buildWiring();
  const manifest = commonsManifest({ name: "detail-pkg", version: "1.2.3" });
  const mockRegistry = new InMemoryTestCommonsRegistry();
  mockRegistry.seed(makeEntry(manifest, ["detail"]));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const detail = await caller.commons.get({ name: "detail-pkg" });
    assert.equal(detail.name, "detail-pkg");
    assert.equal(detail.latest.version, "1.2.3");
    assert.deepEqual(detail.latest.tags, ["detail"]);
    assert.equal(detail.versions.length, 1);
  } finally {
    await wiring.close();
  }
});

test("commons.get: throws NOT_FOUND for unknown name", async () => {
  const wiring = await buildWiring();
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = new InMemoryTestCommonsRegistry();

  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(() => caller.commons.get({ name: "no-such-pkg" }), /NOT_FOUND|not found/i);
  } finally {
    await wiring.close();
  }
});

test("commons.getVersion: returns exact published version", async () => {
  const wiring = await buildWiring();
  const mockRegistry = new InMemoryTestCommonsRegistry();
  mockRegistry.seed(makeEntry(commonsManifest({ name: "versioned", version: "1.0.0" })));
  mockRegistry.seed(makeEntry(commonsManifest({ name: "versioned", version: "2.0.0" })));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const v1 = await caller.commons.getVersion({ name: "versioned", version: "1.0.0" });
    assert.equal(v1.version, "1.0.0");
    const v2 = await caller.commons.getVersion({ name: "versioned", version: "2.0.0" });
    assert.equal(v2.version, "2.0.0");
  } finally {
    await wiring.close();
  }
});

test("commons.getVersion: throws NOT_FOUND for unknown version", async () => {
  const wiring = await buildWiring();
  const mockRegistry = new InMemoryTestCommonsRegistry();
  mockRegistry.seed(makeEntry(commonsManifest({ name: "versioned2", version: "1.0.0" })));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () => caller.commons.getVersion({ name: "versioned2", version: "99.0.0" }),
      /NOT_FOUND|not found/i,
    );
  } finally {
    await wiring.close();
  }
});

test("commons.installPropose: fetches from registry, registers private installation", async () => {
  const wiring = await buildWiring();
  const manifest: ModuleManifest = {
    ...commonsManifest({ name: "install-me", version: "1.0.0" }),
    kind: "skill",
  };
  const mockRegistry = new InMemoryTestCommonsRegistry();
  mockRegistry.seed(makeEntry(manifest, ["need:interview-calendar-availability"]));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: "install-me",
      ownerModuleName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });
    assert.equal(installation.moduleName, "install-me");
    assert.equal(installation.moduleVersion, "1.0.0");
    assert.equal(installation.state, "private");
    assert.equal(installation.status, "pending_review");
    assert.equal(installation.moduleAttachment?.agentId, "application-agent");

    // The installation can now proceed through modules.install for the governed flow.
    const result = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: installation.id,
      todayKey: "2026-07-15",
    });

    assert.equal(result.installed, true);
    assert.equal(result.risk.effectiveRisk, "informational");
    const interruptedRetry = await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: "install-me",
      ownerModuleName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });
    assert.equal(interruptedRetry.installation.id, installation.id);
    assert.equal(interruptedRetry.installation.state, "promoted");
    assert.equal(interruptedRetry.installation.status, "installed");
    const promoted = await caller.modules.promote({
      organizationId: PILOT_ORGANIZATION,
      installationId: installation.id,
    });
    assert.equal(promoted.installation.state, "available");
    assert.equal(promoted.installation.moduleAttachment?.needId, "interview-calendar-availability");

    const repeated = await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: "install-me",
      ownerModuleName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });
    assert.equal(repeated.installation.id, installation.id);
    assert.equal(repeated.installation.state, "available");
    await assert.rejects(
      () =>
        caller.modules.install({
          organizationId: PILOT_ORGANIZATION,
          installationId: repeated.installation.id,
          todayKey: "2026-07-15",
        }),
      /must be private/,
    );
    assert.equal((await caller.modules.get({ installationId: installation.id })).installation.state, "available");
  } finally {
    await wiring.close();
  }
});

test("commons.runInstalledSkill invokes the pinned Skill through its owning Agent and preserves correction provenance", async () => {
  const builtIn = COMMONS_BUILT_IN_MODULES.find(
    (candidate) => candidate.manifest.name === "cited-role-model-practice",
  );
  assert.ok(builtIn);
  const wiring = await buildWiring();
  const registry = new InMemoryTestCommonsRegistry();
  const registryEntry = makeEntry(builtIn.manifest, [...builtIn.commons.tags]);
  registry.seed(registryEntry);
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = registry;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({
        query: {
          pages: {
            "1": {
              title: "Test Fixture Leader",
              extract: "Test Fixture Leader is documented for public work. This is source context.",
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const caller = await makeCaller(wiring);
    await caller.onboarding.saveProfile({
      organizationId: PILOT_ORGANIZATION,
      avatarStyle: "owl",
      answers: {
        role_model: "Test Fixture Leader",
        role_model_why: "clear preparation",
      },
      verificationMethod: null,
      connectedSourceIds: [],
    });
    const onboardingRecommendation = await caller.onboarding.recommendFromRoleModel({
      organizationId: PILOT_ORGANIZATION,
      figure: "Test Fixture Leader",
      admiredFor: "clear preparation",
    });
    assert.equal(fetchCalls, 1);
    const proposed = await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: builtIn.manifest.name,
      ownerModuleName: "relationship",
      agentId: "learning-agent",
      needId: "cited-role-model-practice",
    });
    await assert.rejects(
      () =>
        caller.commons.runInstalledSkill({
          organizationId: PILOT_ORGANIZATION,
          installationId: proposed.installation.id,
        }),
      /must be installed and available/i,
    );
    const installed = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: proposed.installation.id,
      todayKey: "2026-07-18",
    });
    assert.equal(installed.installed, true);
    await caller.modules.promote({
      organizationId: PILOT_ORGANIZATION,
      installationId: proposed.installation.id,
    });

    const listed = await caller.modules.list({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
      offset: 0,
    });
    const attachment = listed.items.find((item) => item.id === proposed.installation.id);
    assert.deepEqual(attachment?.runtimeSkillIds, [LEARNING_RECOMMENDATION_SKILL_ID]);

    const currentRegistryHash = registryEntry.integrity.value;
    registryEntry.integrity.value = `sha256:${"0".repeat(64)}`;
    const listedAfterRegistryDrift = await caller.modules.list({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
      offset: 0,
    });
    assert.deepEqual(
      listedAfterRegistryDrift.items.find((item) => item.id === proposed.installation.id)?.runtimeSkillIds,
      [],
    );
    assert.match(
      listedAfterRegistryDrift.items.find((item) => item.id === proposed.installation.id)
        ?.runtimeBindingIssues[0] ?? "",
      /pinned root result/,
    );
    registryEntry.integrity.value = currentRegistryHash;

    const storedInstallation = await wiring.moduleStore.get(proposed.installation.id);
    assert.ok(storedInstallation);
    const storedPermission = storedInstallation.manifest.capabilities[0]?.permissions[0];
    assert.ok(storedPermission);
    storedPermission.dataScope = "all";
    const listedAfterContractTamper = await caller.modules.list({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
      offset: 0,
    });
    assert.deepEqual(
      listedAfterContractTamper.items.find((item) => item.id === proposed.installation.id)?.runtimeSkillIds,
      [],
    );
    await assert.rejects(
      () =>
        caller.commons.runInstalledSkill({
          organizationId: PILOT_ORGANIZATION,
          installationId: proposed.installation.id,
        }),
      /supported signed runtime contract/i,
    );
    storedPermission.dataScope = "private";

    const ownerModule = await wiring.moduleStore.getAvailable(PILOT_ORGANIZATION, "relationship");
    assert.ok(ownerModule);
    await wiring.moduleStore.setState(ownerModule.id, "legacy");
    const replacementModule = await wiring.moduleStore.create({
      organizationId: PILOT_ORGANIZATION,
      moduleName: ownerModule.moduleName,
      moduleVersion: "99.0.0",
      manifest: {
        ...ownerModule.manifest,
        version: "99.0.0",
        summary: "Replacement Relationship contract",
      },
      computedRisk: ownerModule.computedRisk,
      state: "available",
      status: "installed",
      lineageManifestId: ownerModule.lineageManifestId,
    });
    const listedWithReplacementOwner = await caller.modules.list({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
      offset: 0,
    });
    assert.deepEqual(
      listedWithReplacementOwner.items.find((item) => item.id === proposed.installation.id)?.runtimeSkillIds,
      [],
    );
    await assert.rejects(
      () =>
        caller.commons.runInstalledSkill({
          organizationId: PILOT_ORGANIZATION,
          installationId: proposed.installation.id,
        }),
      /supported owning Module contract/i,
    );
    await wiring.moduleStore.setState(replacementModule.id, "legacy");
    await wiring.moduleStore.setState(ownerModule.id, "available");
    const ownerSummary = ownerModule.manifest.summary;
    try {
      ownerModule.manifest.summary = "Tampered Relationship contract";
      const listedWithTamperedOwner = await caller.modules.list({
        organizationId: PILOT_ORGANIZATION,
        limit: 100,
        offset: 0,
      });
      assert.deepEqual(
        listedWithTamperedOwner.items.find((item) => item.id === proposed.installation.id)?.runtimeSkillIds,
        [],
      );
      await assert.rejects(
        () =>
          caller.commons.runInstalledSkill({
            organizationId: PILOT_ORGANIZATION,
            installationId: proposed.installation.id,
          }),
        /supported owning Module contract/i,
      );
    } finally {
      ownerModule.manifest.summary = ownerSummary;
    }

    await assert.rejects(
      () =>
        caller.commons.runInstalledSkill({
          organizationId: PILOT_ORGANIZATION,
          installationId: proposed.installation.id,
        }),
      /Approve a cited role-model onboarding recommendation/,
    );
    assert.equal(fetchCalls, 1);
    await caller.action.decide({
      proposalId: onboardingRecommendation.proposal.id,
      decision: "approve",
    });
    const result = await caller.commons.runInstalledSkill({
      organizationId: PILOT_ORGANIZATION,
      installationId: proposed.installation.id,
    });
    assert.equal(fetchCalls, 1, "the installed no-egress Skill must reuse the approved local Signal");
    assert.equal(result.proposal.status, "pending_review");
    assert.deepEqual(result.proposal.request.actor, {
      type: "agent",
      id: LEARNING_AGENT,
    });
    assert.equal(result.proposal.request.skill, LEARNING_RECOMMENDATION_SKILL_ID);
    assert.equal(result.proposal.request.dataScope, "private");
    const proposedOutput = result.proposal.output?.proposedOutput as {
      title: string;
      commonsInvocation: {
        installationId: string;
        contentHash: string;
        moduleInstallationId: string;
        ownerModuleName: string;
        ownerModuleVersion: string;
        ownerModuleManifestHash: string;
        ownerModuleAgentId: string;
        runtimeAgentId: string;
        capabilityId: string;
      };
    };
    assert.equal(proposedOutput.commonsInvocation.installationId, proposed.installation.id);
    assert.equal(proposedOutput.commonsInvocation.contentHash, proposed.installation.moduleAttachment?.contentHash);
    assert.equal(proposedOutput.commonsInvocation.moduleInstallationId, ownerModule.id);
    assert.equal(proposedOutput.commonsInvocation.ownerModuleName, "relationship");
    assert.equal(proposedOutput.commonsInvocation.ownerModuleVersion, ownerModule.moduleVersion);
    assert.match(proposedOutput.commonsInvocation.ownerModuleManifestHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(proposedOutput.commonsInvocation.ownerModuleAgentId, "learning-agent");
    assert.equal(proposedOutput.commonsInvocation.runtimeAgentId, LEARNING_AGENT);
    assert.equal(proposedOutput.commonsInvocation.capabilityId, LEARNING_RECOMMENDATION_SKILL_ID);
    const privateProposal = await wiring.ledger.get(result.proposal.id);
    assert.equal(privateProposal?.dataScope, "private");
    assert.ok(privateProposal);
    delete privateProposal.dataScope;

    const invited = await wiring.organizationStore.inviteMember(
      PILOT_ORGANIZATION,
      "test_fixture_intruder@example.com",
    );
    const otherCaller = await makeCaller(wiring, invited.userId);
    const otherPending = await otherCaller.action.listPending({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
      offset: 0,
    });
    assert.equal(otherPending.items.some((entry) => entry.id === result.proposal.id), false);
    await assert.rejects(
      () => otherCaller.action.resolution({ proposalId: result.proposal.id }),
      /proposal not found/i,
    );
    await assert.rejects(
      () =>
        otherCaller.action.decide({
          proposalId: result.proposal.id,
          decision: "approve",
        }),
      /proposal not found/i,
    );

    const editedOutput = {
      ...proposedOutput,
      title: "Practice careful preparation deliberately",
      commonsInvocation: {
        ...proposedOutput.commonsInvocation,
        contentHash: "sha256:tampered-client-value",
      },
    };
    const decision = await caller.action.decide({
      proposalId: result.proposal.id,
      decision: "edit",
      editedOutput,
    });
    assert.equal(decision.status, "applied");
    const decisionEntry = await wiring.ledger.decisionFor(result.proposal.id);
    const ledgerEntry = await wiring.ledger.get(result.proposal.id);
    assert.equal(decisionEntry?.userDecision, "edit");
    const committedOutput = decisionEntry?.proposedOutput as typeof proposedOutput;
    assert.equal(committedOutput.title, editedOutput.title);
    assert.deepEqual(
      committedOutput.commonsInvocation,
      proposedOutput.commonsInvocation,
      "the server must preserve installed-module provenance across a Human correction",
    );
    assert.equal(
      (ledgerEntry?.inputs as { commonsInvocation?: { installationId?: string } }).commonsInvocation?.installationId,
      proposed.installation.id,
    );
    const otherHistory = await otherCaller.action.listHistory({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
      offset: 0,
    });
    assert.equal(
      otherHistory.items.some(
        (entry) => entry.id === result.proposal.id || entry.refLedgerId === result.proposal.id,
      ),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await wiring.close();
  }
});

test("commons install enforces the signed scan risk as a governance floor", async () => {
  const wiring = await buildWiring();
  const manifest: ModuleManifest = {
    ...commonsManifest({ name: "risk-floor", version: "1.0.0" }),
    kind: "skill",
  };
  const mockRegistry = new InMemoryTestCommonsRegistry();
  mockRegistry.seed(makeUnsignedCommonsEntry(
    manifest,
    ["need:interview-calendar-availability"],
    { ...TEST_COMMONS_SCAN, riskBand: "operational" },
  ));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: "risk-floor",
      ownerModuleName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });
    assert.equal(installation.computedRisk, "operational");

    const result = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: installation.id,
      todayKey: "2026-07-16",
    });
    assert.equal(result.installed, false);
    assert.ok(result.proposal);
    assert.equal(result.risk.effectiveRisk, "operational");
    assert.equal(result.proposal.status, "pending_review");
    const repeated = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: installation.id,
      todayKey: "2026-07-16",
    });
    assert.equal(repeated.installed, false);
    assert.ok(repeated.proposal);
    assert.equal(repeated.proposal.id, result.proposal.id);
    const pending = await caller.action.listPending({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
      offset: 0,
    });
    assert.equal(pending.items.filter((proposal) => proposal.id === result.proposal.id).length, 1);
    const approved = await caller.action.decide({
      proposalId: result.proposal.id,
      decision: "approve",
    });
    assert.equal(approved.status, "applied");
    assert.ok("moduleInstallation" in approved);
    assert.equal(approved.moduleInstallation.status, "installed");
    assert.equal(approved.moduleInstallation.state, "promoted");
    assert.equal(
      (await caller.modules.get({ installationId: installation.id })).installation.computedRisk,
      "operational",
    );
  } finally {
    await wiring.close();
  }
});

test("commons install veto leaves the signed module private and cannot be retried under the resolved proposal", async () => {
  const wiring = await buildWiring();
  const manifest: ModuleManifest = {
    ...commonsManifest({ name: "risk-veto", version: "1.0.0" }),
    kind: "skill",
  };
  const mockRegistry = new InMemoryTestCommonsRegistry();
  mockRegistry.seed(makeUnsignedCommonsEntry(
    manifest,
    ["need:interview-calendar-availability"],
    { ...TEST_COMMONS_SCAN, riskBand: "operational" },
  ));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: manifest.name,
      ownerModuleName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });
    const staged = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: installation.id,
      todayKey: "2026-07-16",
    });
    assert.equal(staged.installed, false);
    assert.ok(staged.proposal);
    await caller.action.decide({ proposalId: staged.proposal.id, decision: "veto" });
    const unchanged = await caller.modules.get({ installationId: installation.id });
    assert.equal(unchanged.installation.status, "pending_review");
    assert.equal(unchanged.installation.state, "private");
    await assert.rejects(
      () =>
        caller.modules.install({
          organizationId: PILOT_ORGANIZATION,
          installationId: installation.id,
          todayKey: "2026-07-16",
        }),
      /vetoed/,
    );
  } finally {
    await wiring.close();
  }
});

test("commons approved install reconciles idempotently after a transient post-decision trust failure", async () => {
  const wiring = await buildWiring();
  const manifest: ModuleManifest = {
    ...commonsManifest({ name: "risk-reconcile", version: "1.0.0" }),
    kind: "skill",
  };
  const mockRegistry = new InMemoryTestCommonsRegistry();
  mockRegistry.seed(makeUnsignedCommonsEntry(
    manifest,
    ["need:interview-calendar-availability"],
    { ...TEST_COMMONS_SCAN, riskBand: "operational" },
  ));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: manifest.name,
      ownerModuleName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });
    const staged = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: installation.id,
      todayKey: "2026-07-16",
    });
    assert.equal(staged.installed, false);
    assert.ok(staged.proposal);
    const proposalId = staged.proposal.id;
    const proposalEntry = await wiring.ledger.get(proposalId);
    assert.equal(proposalEntry?.action, "write");
    assert.equal(proposalEntry?.resourceType, "signal");
    assert.equal(proposalEntry?.resourceId, installation.id);
    assert.equal(
      (proposalEntry?.inputs as Record<string, unknown> | undefined)?.operation,
      "module_install",
    );

    (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = new InMemoryTestCommonsRegistry();
    const failedResolution = await caller.action.decide({
      proposalId,
      decision: "approve",
    });
    assert.equal(failedResolution.effectsStatus, "failed");
    assert.match(failedResolution.effectsError ?? "", /pinned root result/);
    assert.equal((await wiring.ledger.decisionFor(proposalId))?.userDecision, "approve");
    assert.equal(
      (await caller.modules.get({ installationId: installation.id })).installation.status,
      "pending_review",
    );

    (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;
    const reconciled = await caller.modules.reconcileApproved({ proposalId });
    const repeated = await caller.modules.reconcileApproved({ proposalId });
    assert.equal(reconciled.installation.status, "installed");
    assert.equal(reconciled.installation.state, "promoted");
    assert.equal(repeated.installation.id, reconciled.installation.id);
    assert.equal(repeated.installation.status, "installed");
  } finally {
    await wiring.close();
  }
});

test("commons approval and promotion revalidate the current owning Module need", async () => {
  const wiring = await buildWiring();
  const operational: ModuleManifest = {
    ...commonsManifest({ name: "need-recheck-operational", version: "1.0.0" }),
    kind: "skill",
  };
  const informational: ModuleManifest = {
    ...commonsManifest({ name: "need-recheck-informational", version: "1.0.0" }),
    kind: "skill",
  };
  const needTag = "need:interview-calendar-availability";
  const mockRegistry = new InMemoryTestCommonsRegistry()
    .seed(makeUnsignedCommonsEntry(
      operational,
      [needTag],
      { ...TEST_COMMONS_SCAN, riskBand: "operational" },
    ))
    .seed(makeUnsignedCommonsEntry(informational, [needTag]));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const operationalInstallation = (await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: operational.name,
      ownerModuleName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    })).installation;
    const informationalInstallation = (await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: informational.name,
      ownerModuleName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    })).installation;
    const stagedOperational = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: operationalInstallation.id,
      todayKey: "2026-07-16",
    });
    assert.equal(stagedOperational.installed, false);
    assert.ok(stagedOperational.proposal);
    const operationalProposalId = stagedOperational.proposal.id;
    const installedInformational = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: informationalInstallation.id,
      todayKey: "2026-07-16",
    });
    assert.equal(installedInformational.installed, true);

    const owner = await wiring.moduleStore.getAvailable(PILOT_ORGANIZATION, "job-pilot");
    assert.ok(owner);
    assert.ok(owner.manifest.module);
    await wiring.moduleStore.setState(owner.id, "legacy");
    await wiring.moduleStore.create({
      organizationId: PILOT_ORGANIZATION,
      moduleName: owner.moduleName,
      moduleVersion: "99.0.0",
      manifest: {
        ...owner.manifest,
        version: "99.0.0",
        module: { ...owner.manifest.module, commonsNeeds: [] },
      },
      computedRisk: owner.computedRisk,
      state: "available",
      status: "installed",
      lineageManifestId: owner.lineageManifestId,
    });

    const failedApproval = await caller.action.decide({
      proposalId: operationalProposalId,
      decision: "approve",
    });
    assert.equal(failedApproval.effectsStatus, "failed");
    assert.match(failedApproval.effectsError ?? "", /need is no longer owned/);
    await assert.rejects(
      () =>
        caller.modules.promote({
          organizationId: PILOT_ORGANIZATION,
          installationId: informationalInstallation.id,
        }),
      /need is no longer owned/,
    );
    assert.equal(
      (await caller.modules.get({ installationId: operationalInstallation.id })).installation.status,
      "pending_review",
    );
    assert.equal(
      (await caller.modules.get({ installationId: informationalInstallation.id })).installation.state,
      "promoted",
    );
  } finally {
    await wiring.close();
  }
});

test("commons install stages and governs exact pinned dependencies", async () => {
  const wiring = await buildWiring();
  const dependency: ModuleManifest = {
    ...commonsManifest({ name: "shared-skill", version: "1.0.0" }),
    kind: "module",
    capabilities: [{
      ...commonsManifest({ name: "shared-skill", version: "1.0.0" }).capabilities[0]!,
      id: "shared-skill.core",
      name: "shared-skill core",
      capabilityType: "skill",
    }],
  };
  const dependencyEntry = makeUnsignedCommonsEntry(dependency);
  const root: ModuleManifest = {
    ...commonsManifest({ name: "dependent-skill", version: "1.0.0" }),
    kind: "skill",
    dependencies: [{ manifestId: dependency.name, version: dependency.version }],
  };
  const rootEntry = makeUnsignedCommonsEntry(
    root,
    ["need:interview-calendar-availability"],
    {
      ...TEST_COMMONS_SCAN,
      dependencyPins: [{
        name: dependency.name,
        version: dependency.version,
        contentHash: dependencyEntry.integrity.value,
      }],
    },
  );
  const mockRegistry = new InMemoryTestCommonsRegistry()
    .seed(dependencyEntry)
    .seed(rootEntry);
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: root.name,
      ownerModuleName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });
    const staged = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    const stagedDependency = staged.items.find((item) => item.moduleName === dependency.name);
    assert.equal(stagedDependency?.status, "pending_review");
    assert.equal(stagedDependency?.moduleAttachment?.contentHash, dependencyEntry.integrity.value);

    const result = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: installation.id,
      todayKey: "2026-07-16",
    });
    assert.equal(result.installed, true);
    const governed = await caller.modules.get({ installationId: stagedDependency!.id });
    assert.equal(governed.installation.status, "installed");
    assert.equal(governed.installation.state, "available");
  } finally {
    await wiring.close();
  }
});

test("commons.installPropose: throws NOT_FOUND when module absent from registry", async () => {
  const wiring = await buildWiring();
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = new InMemoryTestCommonsRegistry();

  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.commons.installPropose({
          organizationId: PILOT_ORGANIZATION,
          name: "ghost-pkg",
          ownerModuleName: "job-pilot",
          agentId: "application-agent",
          needId: "interview-calendar-availability",
        }),
      /NOT_FOUND|not found/i,
    );
  } finally {
    await wiring.close();
  }
});

test("commons.installPropose: rejects an authenticated organization nonmember before registry fetch", async () => {
  const wiring = await buildWiring();
  const mockRegistry = new InMemoryTestCommonsRegistry();
  mockRegistry.seed(makeEntry(commonsManifest({ name: "member-only", version: "1.0.0" })));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "user", id: "d0000000-0000-4000-a000-00000000dead" },
      authenticated: true,
      verifying: false,
    });
    await assert.rejects(
      () =>
        caller.commons.installPropose({
          organizationId: PILOT_ORGANIZATION,
          name: "member-only",
          ownerModuleName: "job-pilot",
          agentId: "application-agent",
          needId: "interview-calendar-availability",
        }),
      /not a member/,
    );
  } finally {
    await wiring.close();
  }
});

test("commons.publishBuiltins: publishes BUILT_IN_MODULES to the mock registry", async () => {
  const wiring = await buildWiring();
  const mockRegistry = new InMemoryTestCommonsRegistry();
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const result = await caller.commons.publishBuiltins();

    assert.equal(result.published.length + result.skipped.length, COMMONS_BUILT_IN_MODULES.length);
    assert.equal(result.skipped.length, 0); // fresh registry, nothing pre-published

    // Second call: all should be skipped as duplicate
    const repeat = await caller.commons.publishBuiltins();
    assert.equal(repeat.published.length, 0);
    assert.equal(repeat.skipped.length, COMMONS_BUILT_IN_MODULES.length);
  } finally {
    await wiring.close();
  }
});

test("commons.installPropose reconciles the signed normalized Task Manager root Module", async () => {
  const localDir = await mkdtemp(join(tmpdir(), "bridge-commons-module-restart-"));
  const builtIn = COMMONS_BUILT_IN_MODULES.find(
    (candidate) => candidate.manifest.name === "task-manager",
  );
  assert.ok(builtIn);
  const normalized = parseModuleManifest({ module: builtIn.manifest });
  const entry = makeEntry(normalized, [...builtIn.commons.tags]);
  let wiring: Wiring | undefined = await buildWiring({ localDir });
  const registry = new InMemoryTestCommonsRegistry().seed(entry);
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = registry;
  try {
    assert.ok(wiring.moduleStore instanceof DrizzleModuleStore);
    const caller = await makeCaller(wiring);
    const existing = await wiring.moduleStore.getAvailable(PILOT_ORGANIZATION, "task-manager");
    assert.ok(existing);
    assert.equal(canonicalizeManifest(existing.manifest), canonicalizeManifest(normalized));
    const result = await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: "task-manager",
      version: normalized.version,
    });
    assert.equal(result.installation.id, existing.id);
    assert.equal(result.installation.commonsSource?.contentHash, entry.integrity.value);
    assert.equal(
      canonicalizeManifest(result.installation.commonsSource!.entry.manifest),
      canonicalizeManifest(result.installation.manifest),
    );
    assert.deepEqual(result.installation.manifest.module?.commonsNeeds, []);

    const nextManifest = {
      ...normalized,
      version: "1.0.3",
      summary: "Task Manager signed upgrade",
      capabilities: normalized.capabilities.map((capability) => ({
        ...capability,
        version: "1.0.3",
      })),
    };
    const nextEntry = makeEntry(nextManifest, [...builtIn.commons.tags]);
    registry.seed(nextEntry);
    const staged = await caller.commons.installPropose({
      organizationId: PILOT_ORGANIZATION,
      name: "task-manager",
      version: nextManifest.version,
    });
    assert.match(staged.installation.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(staged.installation.state, "private");
    assert.equal(staged.installation.commonsSource?.contentHash, nextEntry.integrity.value);
    const install = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: staged.installation.id,
      todayKey: "2026-07-21",
    });
    if (!install.installed && install.proposal) {
      await caller.action.decide({
        proposalId: install.proposal.id,
        decision: "approve",
      });
    }
    const promoted = await caller.modules.promote({
      organizationId: PILOT_ORGANIZATION,
      installationId: staged.installation.id,
    });
    assert.equal(promoted.installation.state, "available");
    assert.equal(promoted.installation.commonsSource?.contentHash, nextEntry.integrity.value);

    entry.integrity.value = `sha256:${"0".repeat(64)}`;
    await assert.rejects(
      () => caller.commons.installPropose({
        organizationId: PILOT_ORGANIZATION,
        name: "task-manager",
        version: normalized.version,
      }),
      /hash_mismatch|trust verification/i,
    );
    await wiring.close();
    wiring = undefined;

    wiring = await buildWiring({ localDir });
    assert.ok(wiring.moduleStore instanceof DrizzleModuleStore);
    const recovered = await wiring.moduleStore.getAvailable(
      PILOT_ORGANIZATION,
      "task-manager",
    );
    assert.equal(recovered?.id, promoted.installation.id);
    assert.equal(recovered?.moduleVersion, nextManifest.version);
    assert.equal(recovered?.status, "installed");
    assert.equal(recovered?.commonsSource?.contentHash, nextEntry.integrity.value);
    const recoveredVersions = await wiring.moduleStore.listVersions(
      PILOT_ORGANIZATION,
      "task-manager",
    );
    const recoveredBuiltIn = recoveredVersions.find(
      (candidate) => candidate.moduleVersion === normalized.version,
    );
    assert.equal(recoveredBuiltIn?.commonsSource?.contentHash, result.installation.commonsSource?.contentHash);
  } finally {
    await wiring?.close();
    await rm(localDir, { recursive: true, force: true });
  }
});
