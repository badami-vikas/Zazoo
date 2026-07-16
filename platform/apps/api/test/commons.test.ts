/**
 * commons.{list,get,getVersion,installPropose,publishBuiltins} — CM0 wire:
 * commons.* tRPC over CommonsRegistry port (egg-commons-feature-roadmap §CM0).
 *
 * Test strategy: inject an in-memory CommonsRegistry mock so tests don't
 * require a running services/commons instance. The mock is swapped onto the
 * Wiring object after buildWiring() (the same wiring object the createCaller
 * context receives), so the procedures under test see it transparently.
 *
 * Pattern mirrors packages.test.ts (buildWiring + appRouter.createCaller).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type CommonsProvenance, type RunCtx } from "@bridge/core";
import type {
  CommonsListQuery,
  CommonsListResult,
  CommonsPackageDetail,
  CommonsPackageEntry,
  CommonsRegistry,
} from "@bridge/core";
import type { PackageManifest } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_WORKSPACE, type Wiring } from "../src/wiring.js";
import { makeUnsignedCommonsEntry, TEST_COMMONS_SCAN } from "./commons-fixtures.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

/** Minimal valid PackageManifest as the registry would serve it. */
function commonsManifest(overrides: Partial<{ name: string; version: string }> = {}): PackageManifest {
  const name = overrides.name ?? "test-commons-pkg";
  const version = overrides.version ?? "1.0.0";
  return {
    name,
    version,
    kind: "workspace_definition",
    summary: "Test Commons package",
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
    workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  };
}

function makeEntry(manifest: PackageManifest, tags: string[] = []): CommonsPackageEntry {
  return makeUnsignedCommonsEntry(manifest, tags);
}

// ---------------------------------------------------------------------------
// In-memory CommonsRegistry mock — no crypto, no network, no running service.
// ---------------------------------------------------------------------------

class InMemoryTestCommonsRegistry implements CommonsRegistry {
  private readonly entries: Map<string, CommonsPackageEntry[]> = new Map();

  /** Seed the registry with entries for testing. */
  seed(entry: CommonsPackageEntry): this {
    const versions = this.entries.get(entry.name) ?? [];
    versions.push(entry);
    this.entries.set(entry.name, versions);
    return this;
  }

  async listAvailable(query: CommonsListQuery = {}): Promise<CommonsListResult> {
    let all: CommonsPackageEntry[] = [];
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

  async get(name: string): Promise<CommonsPackageDetail | null> {
    const versions = this.entries.get(name);
    if (!versions || versions.length === 0) return null;
    const latest = versions.at(-1)!;
    return {
      name,
      latest,
      versions: versions.map((v) => ({ version: v.version, publishedAt: v.publishedAt })),
    };
  }

  async getVersion(name: string, version: string): Promise<CommonsPackageEntry | null> {
    return this.entries.get(name)?.find((e) => e.version === version) ?? null;
  }

  async publish(
    manifest: PackageManifest,
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

test("commons.list: returns packages from the registry (mock)", async () => {
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
  const skillManifest: PackageManifest = { ...commonsManifest({ name: "skill-pkg" }), kind: "workspace_definition" };
  mockRegistry.seed(makeEntry(commonsManifest({ name: "ws-pkg" }), []));
  mockRegistry.seed(makeEntry(skillManifest, []));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const result = await caller.commons.list({ kind: "workspace_definition" });
    assert.equal(result.total, 2); // both are workspace_definition in this fixture
    assert.ok(result.items.every((i) => i.kind === "workspace_definition"));
  } finally {
    await wiring.close();
  }
});

test("commons.get: returns package detail for known name", async () => {
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
  const manifest: PackageManifest = {
    ...commonsManifest({ name: "install-me", version: "1.0.0" }),
    kind: "skill",
  };
  const mockRegistry = new InMemoryTestCommonsRegistry();
  mockRegistry.seed(makeEntry(manifest, ["need:interview-calendar-availability"]));
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.commons.installPropose({
      workspaceId: PILOT_WORKSPACE,
      name: "install-me",
      modulePackageName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });

    assert.equal(installation.packageName, "install-me");
    assert.equal(installation.packageVersion, "1.0.0");
    assert.equal(installation.state, "private");
    assert.equal(installation.status, "pending_review");
    assert.equal(installation.moduleAttachment?.agentId, "application-agent");

    // The installation can now proceed through packages.install for the governed flow.
    const result = await caller.packages.install({
      workspaceId: PILOT_WORKSPACE,
      installationId: installation.id,
      todayKey: "2026-07-15",
    });
    assert.equal(result.installed, true);
    assert.equal(result.risk.effectiveRisk, "informational");
    const interruptedRetry = await caller.commons.installPropose({
      workspaceId: PILOT_WORKSPACE,
      name: "install-me",
      modulePackageName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });
    assert.equal(interruptedRetry.installation.id, installation.id);
    assert.equal(interruptedRetry.installation.state, "promoted");
    assert.equal(interruptedRetry.installation.status, "installed");
    const promoted = await caller.packages.promote({
      workspaceId: PILOT_WORKSPACE,
      installationId: installation.id,
    });
    assert.equal(promoted.installation.state, "available");
    assert.equal(promoted.installation.moduleAttachment?.needId, "interview-calendar-availability");

    const repeated = await caller.commons.installPropose({
      workspaceId: PILOT_WORKSPACE,
      name: "install-me",
      modulePackageName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });
    assert.equal(repeated.installation.id, installation.id);
    assert.equal(repeated.installation.state, "available");
    await assert.rejects(
      () =>
        caller.packages.install({
          workspaceId: PILOT_WORKSPACE,
          installationId: repeated.installation.id,
          todayKey: "2026-07-15",
        }),
      /must be private/,
    );
    assert.equal((await caller.packages.get({ installationId: installation.id })).installation.state, "available");
  } finally {
    await wiring.close();
  }
});

test("commons install enforces the signed scan risk as a governance floor", async () => {
  const wiring = await buildWiring();
  const manifest: PackageManifest = {
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
      workspaceId: PILOT_WORKSPACE,
      name: "risk-floor",
      modulePackageName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });
    assert.equal(installation.computedRisk, "operational");

    const result = await caller.packages.install({
      workspaceId: PILOT_WORKSPACE,
      installationId: installation.id,
      todayKey: "2026-07-16",
    });
    assert.equal(result.installed, false);
    assert.equal(result.risk.effectiveRisk, "operational");
    assert.equal(
      (await caller.packages.get({ installationId: installation.id })).installation.computedRisk,
      "operational",
    );
  } finally {
    await wiring.close();
  }
});

test("commons install stages and governs exact pinned dependency artifacts", async () => {
  const wiring = await buildWiring();
  const dependency: PackageManifest = {
    ...commonsManifest({ name: "shared-tool", version: "1.0.0" }),
    kind: "tool",
    capabilities: [{
      ...commonsManifest({ name: "shared-tool", version: "1.0.0" }).capabilities[0]!,
      id: "shared-tool.core",
      name: "shared-tool core",
      capabilityType: "tool",
    }],
  };
  const dependencyEntry = makeUnsignedCommonsEntry(dependency);
  const root: PackageManifest = {
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
      workspaceId: PILOT_WORKSPACE,
      name: root.name,
      modulePackageName: "job-pilot",
      agentId: "application-agent",
      needId: "interview-calendar-availability",
    });
    const staged = await caller.packages.list({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 });
    const stagedDependency = staged.items.find((item) => item.packageName === dependency.name);
    assert.equal(stagedDependency?.status, "pending_review");
    assert.equal(stagedDependency?.moduleAttachment?.contentHash, dependencyEntry.integrity.value);

    const result = await caller.packages.install({
      workspaceId: PILOT_WORKSPACE,
      installationId: installation.id,
      todayKey: "2026-07-16",
    });
    assert.equal(result.installed, true);
    const governed = await caller.packages.get({ installationId: stagedDependency!.id });
    assert.equal(governed.installation.status, "installed");
    assert.equal(governed.installation.state, "available");
  } finally {
    await wiring.close();
  }
});

test("commons.installPropose: throws NOT_FOUND when package absent from registry", async () => {
  const wiring = await buildWiring();
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = new InMemoryTestCommonsRegistry();

  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.commons.installPropose({
          workspaceId: PILOT_WORKSPACE,
          name: "ghost-pkg",
          modulePackageName: "job-pilot",
          agentId: "application-agent",
          needId: "interview-calendar-availability",
        }),
      /NOT_FOUND|not found/i,
    );
  } finally {
    await wiring.close();
  }
});

test("commons.installPropose: rejects an authenticated workspace nonmember before registry fetch", async () => {
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
      verifying: true,
    });
    await assert.rejects(
      () =>
        caller.commons.installPropose({
          workspaceId: PILOT_WORKSPACE,
          name: "member-only",
          modulePackageName: "job-pilot",
          agentId: "application-agent",
          needId: "interview-calendar-availability",
        }),
      /not a member/,
    );
  } finally {
    await wiring.close();
  }
});

test("commons.publishBuiltins: publishes BUILT_IN_PACKAGES to the mock registry", async () => {
  const wiring = await buildWiring();
  const mockRegistry = new InMemoryTestCommonsRegistry();
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = mockRegistry;

  try {
    const caller = await makeCaller(wiring);
    const result = await caller.commons.publishBuiltins();

    assert.equal(result.published.length + result.skipped.length, 5);
    assert.equal(result.skipped.length, 0); // fresh registry, nothing pre-published

    // Second call: all should be skipped as duplicate
    const repeat = await caller.commons.publishBuiltins();
    assert.equal(repeat.published.length, 0);
    assert.equal(repeat.skipped.length, 5);
  } finally {
    await wiring.close();
  }
});
