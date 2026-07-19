import assert from "node:assert/strict";
import test from "node:test";
import type { GoogleGateway, GoogleGatewayFactory } from "@bridge/integrations-google";
import type { QuarantinedCapture } from "@bridge/capability-kit";
import { createGmailFetchMessages, type GmailFetchReceipt } from "../src/connectors.js";
import {
  LocalDealPilotStore,
  reconcileCredentialOperations,
  type DealPilotStatePort,
} from "../src/runtime-store.js";
import { InMemorySourceCredentialVault } from "../src/credentials.js";

class SharedStatePort implements DealPilotStatePort {
  readonly rows = new Map<string, unknown>();
  readonly #tails = new Map<string, Promise<void>>();

  async read(workspaceId: string, namespace: string): Promise<unknown | null> {
    const value = this.rows.get(JSON.stringify([workspaceId, namespace]));
    return value === undefined ? null : structuredClone(value);
  }

  async update<T>(
    workspaceId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => { state: unknown; result: T },
  ): Promise<T> {
    const key = JSON.stringify([workspaceId, namespace]);
    const prior = this.#tails.get(key) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => current);
    this.#tails.set(key, tail);
    await prior;
    try {
      const value = this.rows.has(key) ? this.rows.get(key) : initialState;
      const mutation = reduce(structuredClone(value));
      this.rows.set(key, structuredClone(mutation.state));
      return mutation.result;
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

function runtime(state = new SharedStatePort()) {
  let nextId = 0;
  return {
    state,
    store: new LocalDealPilotStore(state, {
      now: () => "2026-07-18T00:00:00.000Z",
      id: () => `test-id-${++nextId}`,
    }),
  };
}

async function createSource(
  store: LocalDealPilotStore,
  workspaceId = "workspace-a",
  id = "source-a",
) {
  return store.createSource({
    id,
    workspaceId,
    name: "Approved alert source",
    link: "https://example.invalid/alerts",
    connectionType: "email_alert",
    spendCap: 5,
    rightsState: "attested",
    rightsAttestedBy: "human-a",
  });
}

function capture(
  captureId: string,
  sourceRecordId: string,
  payload: Record<string, unknown> = {
    name: "Northstar Services",
    domain: "northstar.example",
    revenue: 1_000_000,
  },
): QuarantinedCapture {
  return {
    captureId,
    sourceRecordId,
    moduleId: "dealpilot",
    sourceConnectorId: "bizbuysell-alerts",
    tier: "email",
    query: { kind: "company", hints: {} },
    payload,
    confidence: 0.9,
    costUnits: 0.5,
    capturedAt: "2026-07-18T00:00:00.000Z",
    trustOrigin: "untrusted_external",
  };
}

test("credential create and revoke journals reconcile across process restart without plaintext", async () => {
  const { state, store } = runtime();
  const vault = new InMemorySourceCredentialVault();
  const scope = { workspaceId: "workspace-a", sourceId: "source-journaled" };
  const reference = vault.reserve(scope);
  await store.prepareCredentialCreate({
    id: scope.sourceId,
    workspaceId: scope.workspaceId,
    name: "Journaled source",
    link: "https://example.invalid/journaled",
    connectionType: "account",
    credentialOwnerId: "human-a",
    credentialRef: reference,
    spendCap: 0,
    rightsState: "attested",
    rightsAttestedBy: "human-a",
  });
  assert.equal(await store.get("source", scope.workspaceId, scope.sourceId), null);
  assert.equal(
    JSON.stringify([...state.rows.values()]).includes("test_fixture_secret"),
    false,
  );

  await vault.write(scope, reference, { password: "test_fixture_secret" });
  const afterCreateCrash = new LocalDealPilotStore(state);
  await reconcileCredentialOperations(
    afterCreateCrash,
    vault,
    scope.workspaceId,
  );
  const created = await afterCreateCrash.get(
    "source",
    scope.workspaceId,
    scope.sourceId,
  );
  assert.equal(
    created?.kind === "source" ? created.credentialRef : undefined,
    reference,
  );
  assert.deepEqual(
    await afterCreateCrash.pendingCredentialOperations(scope.workspaceId),
    [],
  );

  const audit = {
    workspaceId: scope.workspaceId,
    sourceId: scope.sourceId,
    actorId: "human-a",
    action: "revoke" as const,
    field: "credential" as const,
    occurredAt: "2026-07-18T00:00:00.000Z",
  };
  await afterCreateCrash.prepareCredentialRevocation(
    scope.workspaceId,
    scope.sourceId,
    "human-a",
    reference,
    audit,
  );
  await vault.delete(scope, reference);

  const afterRevokeCrash = new LocalDealPilotStore(state);
  await reconcileCredentialOperations(
    afterRevokeCrash,
    vault,
    scope.workspaceId,
  );
  const revoked = await afterRevokeCrash.get(
    "source",
    scope.workspaceId,
    scope.sourceId,
  );
  assert.equal(
    revoked?.kind === "source" ? revoked.credentialRef : "unexpected-kind",
    undefined,
  );
  assert.deepEqual(
    (await afterRevokeCrash.credentialAuditEvents(scope.workspaceId)).map(
      (event) => event.action,
    ),
    ["revoke"],
  );
});

test("credential create journal discards a reservation that never reached the vault", async () => {
  const { state, store } = runtime();
  const vault = new InMemorySourceCredentialVault();
  const scope = { workspaceId: "workspace-a", sourceId: "source-abandoned" };
  const reference = vault.reserve(scope);
  await store.prepareCredentialCreate({
    id: scope.sourceId,
    workspaceId: scope.workspaceId,
    name: "Abandoned source",
    link: "https://example.invalid/abandoned",
    connectionType: "account",
    credentialOwnerId: "human-a",
    credentialRef: reference,
    spendCap: 0,
    rightsState: "unattested",
  });

  const afterCrash = new LocalDealPilotStore(state);
  await reconcileCredentialOperations(afterCrash, vault, scope.workspaceId);
  assert.equal(
    await afterCrash.get("source", scope.workspaceId, scope.sourceId),
    null,
  );
  assert.deepEqual(
    await afterCrash.pendingCredentialOperations(scope.workspaceId),
    [],
  );
});

function receipt(batchId: string, complete = true): GmailFetchReceipt {
  return {
    workspaceId: "workspace-a",
    sourceId: "source-a",
    batchId,
    ownerId: "process-a",
    complete,
    checkpointAt: "2026-07-18T00:00:00.000Z",
  };
}

test("runtime state survives adapter recreation, isolates workspaces, and backfills Relations", async () => {
  const first = runtime();
  const source = await createSource(first.store);
  const thesis = await first.store.createThesis({
    workspaceId: "workspace-a",
    name: "Services thesis",
    focus: "Durable services businesses",
  });
  await first.store.quarantineCapture(
    "workspace-a",
    source.id,
    capture("capture-a", "message-a"),
  );
  const committed = await first.store.commitCapture("workspace-a", "capture-a");
  assert.equal(committed.committed, true);
  await first.store.linkSourceThesisWithBackfill({
    workspaceId: "workspace-a",
    kind: "source_thesis",
    fromId: source.id,
    toId: thesis.id,
    confidence: 0.8,
    provenance: "reviewed-discovery",
    evidenceRefs: ["proposal-a"],
  });
  await first.store.append({
    workspaceId: "workspace-a",
    sourceId: source.id,
    actorId: "human-a",
    action: "reveal",
    field: "password",
    occurredAt: "2026-07-18T00:00:00.000Z",
  });
  await createSource(first.store, "workspace-b", "source-a");

  const reopened = new LocalDealPilotStore(first.state, {
    now: () => "2026-07-18T01:00:00.000Z",
    id: () => "reopened-id",
  });
  const deals = await reopened.list("deals", "workspace-a", { limit: 20, offset: 0 });
  assert.equal(deals.total, 1);
  assert.equal((await reopened.list("deals", "workspace-b", { limit: 20, offset: 0 })).total, 0);
  const relations = await reopened.relations("workspace-a", deals.items[0]!.id);
  assert.deepEqual(
    new Set(relations.map((row) => row.kind)),
    new Set(["deal_source", "deal_thesis"]),
  );
  assert.equal((await reopened.credentialAuditEvents("workspace-a")).length, 1);
  assert.equal((await reopened.credentialAuditEvents("workspace-b")).length, 0);
  assert.equal(
    (await reopened.get("source", "workspace-b", "source-a"))?.workspaceId,
    "workspace-b",
  );
});

test("capture quarantine and commit are atomic, idempotent, and concurrency-safe", async () => {
  const { store } = runtime();
  const source = await createSource(store);
  const original = capture("capture-a", "provider-message-a");
  assert.equal(
    await store.quarantineCapture("workspace-a", source.id, original),
    "capture-a",
  );
  assert.equal(
    await store.quarantineCapture("workspace-a", source.id, {
      ...original,
      captureId: "retry-generated-id",
    }),
    "capture-a",
  );
  await assert.rejects(
    store.quarantineCapture("workspace-a", source.id, {
      ...original,
      captureId: "conflicting-id",
      payload: { ...original.payload, revenue: 2_000_000 },
    }),
    /collides with different persisted input/,
  );

  await store.quarantineCapture(
    "workspace-a",
    source.id,
    capture("capture-b", "provider-message-b", {
      name: "Northstar Services Holdings",
      domain: "northstar.example",
      revenue: 1_200_000,
    }),
  );
  const commits = await Promise.all([
    store.commitCapture("workspace-a", "capture-a"),
    store.commitCapture("workspace-a", "capture-b"),
  ]);
  assert.ok(commits.every((result) => result.committed));
  assert.equal(
    (await store.list("deals", "workspace-a", { limit: 20, offset: 0 })).total,
    1,
  );
  assert.deepEqual(await store.commitCapture("workspace-a", "capture-a"), {
    committed: false,
    alreadyCommitted: true,
    recordId: "capture-a",
  });
});

test("discovery settlement atomically persists spend, captures, Gmail state, and retry receipts", async () => {
  const { store } = runtime();
  await createSource(store);
  const firstReceipt = receipt("batch-a");
  await store.stage(firstReceipt, ["message-a"], null);
  const firstCapture = capture("capture-a", "message-a");
  const input = {
    workspaceId: "workspace-a",
    sourceId: "source-a",
    receipt: firstReceipt,
    captures: [firstCapture],
    actualSpend: 0.5,
    droppedForBudget: 0,
    completedAt: "2026-07-18T00:00:00.000Z",
  };
  await assert.rejects(
    store.settleDiscoveryBatch({
      ...input,
      receipt: { ...firstReceipt, workspaceId: "workspace-b" },
    }),
    /outside the requested Organization or Source/,
  );
  await assert.rejects(
    store.settleDiscoveryBatch({
      ...input,
      receipt: { ...firstReceipt, complete: false },
    }),
    /settlement .* is stale/,
  );
  const settled = await store.settleDiscoveryBatch(input);
  assert.equal(settled.status, "settled");
  assert.deepEqual(await store.settleDiscoveryBatch(input), settled);
  await store.acknowledge(firstReceipt);
  const source = await store.get("source", "workspace-a", "source-a");
  assert.equal(source?.kind === "source" ? source.spendToDate : null, 0.5);
  assert.equal((await store.listPendingCaptures("workspace-a")).items.length, 1);
  assert.deepEqual(await store.load("workspace-a", "source-a"), {
    seenMessageIds: ["message-a"],
    lastFetchComplete: true,
    lastCheckpointAt: "2026-07-18T00:00:00.000Z",
  });
  await assert.rejects(
    store.settleDiscoveryBatch({ ...input, actualSpend: 1 }),
    /retried with different input/,
  );

  const secondReceipt = receipt("batch-b");
  await store.stage(secondReceipt, ["message-b"], null);
  await assert.rejects(
    store.settleDiscoveryBatch({
      ...input,
      receipt: secondReceipt,
      captures: [
        capture("capture-a", "message-b", {
          name: "Conflicting company",
        }),
      ],
    }),
    /collides with different persisted input/,
  );
  assert.equal(
    (await store.get("source", "workspace-a", "source-a"))?.kind === "source"
      ? ((await store.get("source", "workspace-a", "source-a")) as { spendToDate: number }).spendToDate
      : null,
    0.5,
  );
  assert.equal((await store.load("workspace-a", "source-a")).pending?.batchId, "batch-b");
  await store.discard(secondReceipt);

  const overBudget = receipt("batch-c");
  await store.stage(overBudget, ["message-c"], null);
  const rejected = await store.settleDiscoveryBatch({
    ...input,
    receipt: overBudget,
    captures: [capture("capture-c", "message-c")],
    actualSpend: 5,
  });
  assert.equal(rejected.status, "budget_exceeded");
  assert.deepEqual(rejected.captureIds, []);
  assert.equal(rejected.source.health, "paused");
  assert.equal(rejected.source.spendToDate, 0.5);
  assert.equal((await store.load("workspace-a", "source-a")).pending, undefined);
});

test("discovery settlement retries remain idempotent after more than 256 later batches", async () => {
  const { store } = runtime();
  await createSource(store);
  const firstReceipt = receipt("retained-batch-0");
  const firstInput = {
    workspaceId: "workspace-a",
    sourceId: "source-a",
    receipt: firstReceipt,
    captures: [],
    actualSpend: 0,
    droppedForBudget: 0,
    completedAt: "2026-07-18T00:00:00.000Z",
  };
  await store.stage(firstReceipt, [], null);
  const firstResult = await store.settleDiscoveryBatch(firstInput);

  for (let index = 1; index <= 257; index += 1) {
    const laterReceipt = receipt(`retained-batch-${index}`);
    await store.stage(laterReceipt, [], null);
    await store.settleDiscoveryBatch({
      ...firstInput,
      receipt: laterReceipt,
    });
  }

  assert.deepEqual(await store.settleDiscoveryBatch(firstInput), firstResult);
});

test("Gmail recovery discards a crashed process batch and preserves same-process concurrent ownership", async () => {
  const { store } = runtime();
  const ownershipReceipt = receipt("shared-batch");
  await store.stage(ownershipReceipt, [], null);
  await store.fail({
    workspaceId: ownershipReceipt.workspaceId,
    sourceId: ownershipReceipt.sourceId,
    batchId: ownershipReceipt.batchId,
    ownerId: "different-process",
    cursorKey: "",
  });
  assert.equal(
    (await store.load(ownershipReceipt.workspaceId, ownershipReceipt.sourceId)).pending
      ?.ownerId,
    ownershipReceipt.ownerId,
  );
  await store.discard(ownershipReceipt);

  const gateway: Pick<GoogleGateway, "fetchThreads"> = {
    fetchThreads: async () => ({
      threads: [
        {
          threadId: "thread-a",
          subject: "New Listing Alert: Northstar Services",
          participants: [],
          lastMessageAt: "2026-07-18T00:00:00.000Z",
          snippet: "",
          messages: [
            {
              messageId: "message-a",
              from: { email: "alerts@bizbuysell.com" },
              to: [],
              receivedAt: "2026-07-18T00:00:00.000Z",
              date: "2026-07-18T00:00:00.000Z",
              subject: "New Listing Alert: Northstar Services",
              bodyText: "Asking Price: $500,000",
            },
          ],
        },
      ],
    }),
  };
  const gateways: GoogleGatewayFactory = {
    forIntegration: async () => gateway as GoogleGateway,
  };
  const query = {
    kind: "company" as const,
    hints: { workspaceId: "workspace-a", sourceId: "source-a" },
  };
  const crashed = createGmailFetchMessages(gateways, "integration-a", undefined, {
    stateStore: store,
  });
  assert.deepEqual((await crashed(query)).map((message) => message.id), ["message-a"]);
  const otherWorkspaceQuery = {
    ...query,
    hints: { workspaceId: "workspace-b", sourceId: "source-a" },
  };
  assert.deepEqual(
    (await crashed(otherWorkspaceQuery)).map((message) => message.id),
    ["message-a"],
  );
  await crashed.acknowledge?.("source-a", "workspace-b");
  assert.deepEqual(
    (await store.load("workspace-b", "source-a")).seenMessageIds,
    ["message-a"],
  );
  assert.equal(
    (await store.load("workspace-a", "source-a")).pending?.ownerId !== undefined,
    true,
  );

  const restarted = createGmailFetchMessages(gateways, "integration-a", undefined, {
    stateStore: store,
    instanceId: "process-b",
  });
  assert.deepEqual((await restarted(query)).map((message) => message.id), ["message-a"]);
  await restarted.acknowledge?.("source-a", "workspace-a");
  const afterRestart = createGmailFetchMessages(gateways, "integration-a", undefined, {
    stateStore: store,
    instanceId: "process-c",
  });
  assert.deepEqual(await afterRestart(query), []);

  let calls = 0;
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const concurrentGateway: Pick<GoogleGateway, "fetchThreads"> = {
    fetchThreads: async () => {
      calls += 1;
      if (calls === 2) release();
      await gate;
      return { threads: [] };
    },
  };
  const concurrent = createGmailFetchMessages(
    { forIntegration: async () => concurrentGateway as GoogleGateway },
    "integration-b",
    undefined,
    { stateStore: store, instanceId: "process-d" },
  );
  const results = await Promise.allSettled([
    concurrent({ kind: "company", hints: { workspaceId: "workspace-a", sourceId: "source-b" } }),
    concurrent({ kind: "company", hints: { workspaceId: "workspace-a", sourceId: "source-b" } }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  await concurrent.acknowledge?.("source-b", "workspace-a");
  assert.equal((await store.load("workspace-a", "source-b")).pending, undefined);
});

test("Gmail continuation, visited tokens, and checkpoint recover in a new connector instance", async () => {
  const { store } = runtime();
  const pageTokens: Array<string | undefined> = [];
  const gateway: Pick<GoogleGateway, "fetchThreads"> = {
    fetchThreads: async (options) => {
      pageTokens.push(options.pageToken);
      const page = options.pageToken
        ? Number(options.pageToken.slice("page-".length))
        : 1;
      const message =
        page === 6
          ? {
              messageId: "message-six",
              from: { email: "alerts@bizbuysell.com" },
              to: [],
              receivedAt: "2026-07-18T00:00:00.000Z",
              date: "2026-07-18T00:00:00.000Z",
              subject: "New Listing Alert: Sixth page",
              bodyText: "Asking Price: $500,000",
            }
          : {
              messageId: `internal-${page}`,
              from: { email: "operator@example.invalid" },
              to: [],
              receivedAt: "2026-07-18T00:00:00.000Z",
              date: "2026-07-18T00:00:00.000Z",
              subject: "Internal message",
              bodyText: "Internal message",
            };
      return {
        threads: [
          {
            threadId: `thread-${page}`,
            subject: message.subject,
            participants: [],
            lastMessageAt: message.receivedAt,
            snippet: "",
            messages: [message],
          },
        ],
        ...(page < 6 ? { nextPageToken: `page-${page + 1}` } : {}),
      };
    },
  };
  const gateways: GoogleGatewayFactory = {
    forIntegration: async () => gateway as GoogleGateway,
  };
  const query = {
    kind: "company" as const,
    hints: {
      workspaceId: "workspace-a",
      sourceId: "source-continuation",
      after: "2026-07-17T00:00:00.000Z",
      scanStartedAt: "2026-07-18T00:00:00.000Z",
      maxResults: "1",
    },
  };
  const beforeRestart = createGmailFetchMessages(gateways, "integration-a", undefined, {
    stateStore: store,
    instanceId: "process-before-restart",
  });
  assert.deepEqual(await beforeRestart(query), []);
  await beforeRestart.acknowledge?.("source-continuation", "workspace-a");
  const saved = await store.load("workspace-a", "source-continuation");
  assert.equal(saved.continuation?.pageToken, "page-6");
  assert.ok(saved.continuation?.visitedPageTokens?.includes("__first_page__"));

  const afterRestart = createGmailFetchMessages(gateways, "integration-a", undefined, {
    stateStore: store,
    instanceId: "process-after-restart",
  });
  const resumed = await afterRestart({
    ...query,
    hints: {
      ...query.hints,
      scanStartedAt: "2026-07-19T00:00:00.000Z",
    },
  });
  assert.deepEqual(resumed.map((message) => message.id), ["message-six"]);
  assert.equal(
    afterRestart.lastCheckpointAt?.("source-continuation", "workspace-a"),
    "2026-07-18T00:00:00.000Z",
  );
  await afterRestart.acknowledge?.("source-continuation", "workspace-a");
  assert.deepEqual(pageTokens, [undefined, "page-2", "page-3", "page-4", "page-5", "page-6"]);
  assert.equal(
    (await store.load("workspace-a", "source-continuation")).lastCheckpointAt,
    "2026-07-18T00:00:00.000Z",
  );
});
