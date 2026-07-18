import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import {
  InMemorySourceCredentialVault,
  KeyringSourceCredentialVault,
  type KeyringEntryFactory,
  type SourceCredentialVault,
} from "@bridge/dealpilot";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_WORKSPACE } from "../src/wiring.js";

function runContext(): RunCtx {
  const clock = new SystemClock();
  return { clock, rng: new SeededRng(17), ids: new UuidGen(clock, new SeededRng(17)) };
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat();
}

test("file-backed API wiring preserves DealPilot state across close and reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-api-dealpilot-"));
  try {
    const first = await buildWiring({
      localDir: root,
      dealPilotCredentialVault: new InMemorySourceCredentialVault(),
    });
    const source = await first.dealpilot.store.createSource({
      id: "source-restart",
      workspaceId: PILOT_WORKSPACE,
      name: "Restart-safe source",
      link: "https://example.invalid/restart-source",
      connectionType: "email_alert",
      spendCap: 10,
      rightsState: "attested",
      rightsAttestedBy: PILOT_USER,
    });
    await first.dealpilot.store.quarantineCapture(PILOT_WORKSPACE, source.id, {
      captureId: "capture-restart",
      sourceRecordId: "message-restart",
      toolId: "dealpilot",
      sourceToolId: "bizbuysell-alerts",
      tier: "email",
      query: { kind: "company", hints: { workspaceId: PILOT_WORKSPACE } },
      payload: { name: "Restart-safe company", domain: "restart-safe.example" },
      confidence: 0.9,
      costUnits: 0.5,
      capturedAt: "2026-07-18T00:00:00.000Z",
      trustOrigin: "untrusted_external",
    });
    await first.dealpilot.store.stage(
      {
        workspaceId: PILOT_WORKSPACE,
        sourceId: source.id,
        batchId: "batch-restart",
        ownerId: "process-before-restart",
        complete: false,
        checkpointAt: "2026-07-18T00:00:00.000Z",
      },
      ["message-restart"],
      {
        cursorKey: "2026-07-17T00:00:00.000Z",
        pageToken: "page-2",
        checkpointAt: "2026-07-18T00:00:00.000Z",
        visitedPageTokens: ["__first_page__"],
      },
    );
    await first.localPlane.graph.recordExternal({
      workspaceId: PILOT_WORKSPACE,
      source: "gmail",
      sourceRecordId: "provider-message-non-uuid",
      entityType: "touchpoint",
      entityId: "provider-entity-non-uuid",
      createdAt: "2026-07-18T00:00:00.000Z",
    });
    await first.close();

    const reopened = await buildWiring({
      localDir: root,
      dealPilotCredentialVault: new InMemorySourceCredentialVault(),
    });
    assert.equal(
      (await reopened.dealpilot.store.list("sources", PILOT_WORKSPACE, {
        limit: 20,
        offset: 0,
      })).total,
      1,
    );
    assert.equal(
      (await reopened.dealpilot.store.listPendingCaptures(PILOT_WORKSPACE)).items.length,
      1,
    );
    const gmail = await reopened.dealpilot.store.load(PILOT_WORKSPACE, source.id);
    assert.equal(gmail.pending?.batchId, "batch-restart");
    assert.equal(gmail.continuation, undefined);
    assert.equal(gmail.pending?.continuation?.pageToken, "page-2");
    assert.equal(
      await reopened.localPlane.graph.hasExternal(
        PILOT_WORKSPACE,
        "gmail",
        "provider-message-non-uuid",
      ),
      true,
    );
    await reopened.close();

    assert.ok((await readFile(join(root, "PG_VERSION"), "utf8")).trim().length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("DealPilot credential plaintext never enters Local Plane files or API projections", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-api-credentials-"));
  const keyringValues = new Map<string, string>();
  const factory: KeyringEntryFactory = (service, account) => {
    const key = `${service}:${account}`;
    return {
      setPassword: async (value) => {
        keyringValues.set(key, value);
      },
      getPassword: async () => keyringValues.get(key),
      deleteCredential: async () => {
        if (keyringValues.delete(key)) return true;
        const missing = new Error("No matching entry found in secure storage");
        missing.name = "NoEntry";
        throw missing;
      },
    };
  };
  const secret = "credential-value-that-must-not-enter-local-files";
  const userId = "credential-owner@example.invalid";
  try {
    const wiring = await buildWiring({
      localDir: root,
      dealPilotCredentialVault: new KeyringSourceCredentialVault({
        service: "com.bridge.test",
        entryFactory: factory,
      }),
    });
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
      name: "Credential-backed source",
      link: "https://example.invalid/credential-source",
      connectionType: "account",
      spendCap: 0,
      rightsAttested: true,
      userId,
      password: secret,
    });
    const detail = await caller.dealpilot.detail({
      workspaceId: PILOT_WORKSPACE,
      kind: "source",
      id: source.id,
    });
    assert.equal(JSON.stringify(detail).includes(secret), false);
    assert.equal(JSON.stringify(detail).includes(userId), false);
    const session = await caller.dealpilot.reauthenticateCredential({
      workspaceId: PILOT_WORKSPACE,
      sourceId: source.id,
    });
    const recordRevocation =
      wiring.dealpilot.store.recordCredentialRevocation.bind(
        wiring.dealpilot.store,
      );
    wiring.dealpilot.store.recordCredentialRevocation = async () => {
      throw new Error("simulated Local Plane write failure");
    };
    await assert.rejects(
      caller.dealpilot.clearCredential({
        workspaceId: PILOT_WORKSPACE,
        sourceId: source.id,
        token: session.token,
      }),
      /simulated Local Plane write failure/,
    );
    assert.equal(keyringValues.size, 0);
    await assert.rejects(
      caller.dealpilot.clearCredential({
        workspaceId: PILOT_WORKSPACE,
        sourceId: source.id,
        token: session.token,
      }),
      /matching re-authentication session is required/,
    );
    wiring.dealpilot.store.recordCredentialRevocation = recordRevocation;
    const retrySession = await caller.dealpilot.reauthenticateCredential({
      workspaceId: PILOT_WORKSPACE,
      sourceId: source.id,
    });
    const revoked = await caller.dealpilot.clearCredential({
      workspaceId: PILOT_WORKSPACE,
      sourceId: source.id,
      token: retrySession.token,
    });
    assert.equal(revoked.cleared, true);
    assert.deepEqual(
      (await wiring.dealpilot.store.credentialAuditEvents(PILOT_WORKSPACE)).map(
        (event) => event.action,
      ),
      ["revoke"],
    );
    await wiring.close();

    const reopened = await buildWiring({
      localDir: root,
      dealPilotCredentialVault: new KeyringSourceCredentialVault({
        service: "com.bridge.test",
        entryFactory: factory,
      }),
    });
    const reopenedSource = await reopened.dealpilot.store.get(
      "source",
      PILOT_WORKSPACE,
      source.id,
    );
    assert.equal(
      reopenedSource?.kind === "source"
        ? reopenedSource.credentialRef
        : "unexpected-kind",
      undefined,
    );
    await reopened.close();

    const files = await filesUnder(root);
    for (const file of files) {
      const content = await readFile(file);
      assert.equal(content.includes(Buffer.from(secret)), false, `${file} contains credential plaintext`);
      assert.equal(content.includes(Buffer.from(userId)), false, `${file} contains credential user id`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Source creation removes its OS credential when the durable Record write fails", async () => {
  const deleted: string[] = [];
  const vault: SourceCredentialVault = {
    put: async () => "keyring://com.bridge.test/compensated-entry",
    metadata: async () => null,
    read: async () => null,
    delete: async (_scope, reference) => {
      deleted.push(reference);
    },
  };
  const wiring = await buildWiring({ dealPilotCredentialVault: vault });
  try {
    const fixedRun = {
      ...runContext(),
      ids: { next: () => "fixed-source-id" },
    };
    const caller = appRouter.createCaller({
      wiring,
      run: fixedRun,
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
    });
    await caller.dealpilot.createSource({
      workspaceId: PILOT_WORKSPACE,
      name: "Existing source",
      link: "https://example.invalid/existing-source",
      connectionType: "account",
      spendCap: 0,
      rightsAttested: true,
    });
    await assert.rejects(
      caller.dealpilot.createSource({
        workspaceId: PILOT_WORKSPACE,
        name: "Conflicting source",
        link: "https://example.invalid/conflicting-source",
        connectionType: "account",
        spendCap: 0,
        rightsAttested: true,
        password: "credential-to-compensate",
      }),
      /already exists/,
    );
    assert.deepEqual(deleted, ["keyring://com.bridge.test/compensated-entry"]);
  } finally {
    await wiring.close();
  }
});

test("separate Node processes reopen DealPilot state and server boot requires an explicit vault", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-api-process-"));
  const dataDir = join(root, "main");
  const wiringUrl = new URL("../src/wiring.js", import.meta.url).href;
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.NODE_TEST_CONTEXT;
  delete cleanEnvironment.BRIDGE_DEALPILOT_CREDENTIAL_VAULT;
  const run = (
    script: string,
    environment: NodeJS.ProcessEnv,
    processDataDir = dataDir,
  ) =>
    spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script, processDataDir],
      { encoding: "utf8", env: environment, timeout: 120_000 },
    );
  try {
    const ephemeral = run(
      `
        const { buildWiring } = await import(${JSON.stringify(wiringUrl)});
        await buildWiring({ allowEphemeralLocalPlane: true });
      `,
      cleanEnvironment,
    );
    assert.notEqual(ephemeral.status, 0);
    assert.match(
      `${ephemeral.stdout}\n${ephemeral.stderr}`,
      /restricted to the isolated Node test runner/,
    );

    const refused = run(
      `
        const { buildWiring } = await import(${JSON.stringify(wiringUrl)});
        await buildWiring({ localDir: process.argv[1] });
      `,
      cleanEnvironment,
    );
    assert.notEqual(refused.status, 0);
    assert.match(
      `${refused.stdout}\n${refused.stderr}`,
      /must explicitly name an approved secure provider/,
    );

    const secureEnvironment = {
      ...cleanEnvironment,
      BRIDGE_DEALPILOT_CREDENTIAL_VAULT: "os-keyring",
    };
    const failedBootDir = join(root, "failed-boot");
    const failedAfterOpen = run(
      `
        const { buildWiring } = await import(${JSON.stringify(wiringUrl)});
        await buildWiring({ localDir: process.argv[1] });
      `,
      {
        ...secureEnvironment,
        NODE_ENV: "production",
        DATABASE_URL: "postgres://127.0.0.1:1/test_fixture_bridge?connect_timeout=1",
      },
      failedBootDir,
    );
    assert.notEqual(failedAfterOpen.status, 0);
    const reopenedAfterFailure = run(
      `
        const { buildWiring } = await import(${JSON.stringify(wiringUrl)});
        const wiring = await buildWiring({ localDir: process.argv[1] });
        await wiring.close();
      `,
      secureEnvironment,
      failedBootDir,
    );
    assert.equal(
      reopenedAfterFailure.status,
      0,
      `${reopenedAfterFailure.stdout}\n${reopenedAfterFailure.stderr}`,
    );

    const holder = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          const { buildWiring } = await import(${JSON.stringify(wiringUrl)});
          const wiring = await buildWiring({ localDir: process.argv[1] });
          process.once("SIGTERM", async () => {
            await wiring.close();
            process.exit(0);
          });
          console.log("READY");
          setInterval(() => {}, 1_000);
        `,
        dataDir,
      ],
      { env: secureEnvironment, stdio: ["ignore", "pipe", "pipe"] },
    );
    let holderError = "";
    holder.stderr.setEncoding("utf8");
    holder.stderr.on("data", (chunk: string) => {
      holderError += chunk;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Local Plane holder did not start: ${holderError}`)),
          120_000,
        );
        holder.stdout.setEncoding("utf8");
        holder.stdout.on("data", (chunk: string) => {
          if (!chunk.includes("READY")) return;
          clearTimeout(timeout);
          resolve();
        });
        holder.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Local Plane holder exited early (${code}): ${holderError}`));
        });
      });
      const concurrentlyRefused = run(
        `
          const { buildWiring } = await import(${JSON.stringify(wiringUrl)});
          await buildWiring({ localDir: process.argv[1] });
        `,
        secureEnvironment,
      );
      assert.notEqual(concurrentlyRefused.status, 0);
      assert.match(
        `${concurrentlyRefused.stdout}\n${concurrentlyRefused.stderr}`,
        /another process owns it/,
      );
    } finally {
      if (holder.exitCode === null) {
        const holderExited = once(holder, "exit");
        holder.kill("SIGTERM");
        const forceStop = setTimeout(() => holder.kill("SIGKILL"), 30_000);
        try {
          await holderExited;
        } finally {
          clearTimeout(forceStop);
        }
      }
    }

    const written = run(
      `
        const { buildWiring, PILOT_WORKSPACE } = await import(${JSON.stringify(wiringUrl)});
        const wiring = await buildWiring({ localDir: process.argv[1] });
        await wiring.dealpilot.store.createSource({
          id: "process-source",
          workspaceId: PILOT_WORKSPACE,
          name: "Process restart source",
          link: "https://example.invalid/process-source",
          connectionType: "email_alert",
          spendCap: 1,
          rightsState: "attested",
          rightsAttestedBy: "process-human"
        });
        await wiring.close();
      `,
      secureEnvironment,
    );
    assert.equal(written.status, 0, `${written.stdout}\n${written.stderr}`);

    const reopened = run(
      `
        const { buildWiring, PILOT_WORKSPACE } = await import(${JSON.stringify(wiringUrl)});
        const wiring = await buildWiring({ localDir: process.argv[1] });
        const source = await wiring.dealpilot.store.get("source", PILOT_WORKSPACE, "process-source");
        console.log("RESULT:" + JSON.stringify({ id: source?.id, workspaceId: source?.workspaceId }));
        await wiring.close();
      `,
      secureEnvironment,
    );
    assert.equal(reopened.status, 0, `${reopened.stdout}\n${reopened.stderr}`);
    const resultLine = reopened.stdout
      .split("\n")
      .find((line) => line.startsWith("RESULT:"));
    assert.deepEqual(JSON.parse(resultLine?.slice("RESULT:".length) ?? "null"), {
      id: "process-source",
      workspaceId: PILOT_WORKSPACE,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
