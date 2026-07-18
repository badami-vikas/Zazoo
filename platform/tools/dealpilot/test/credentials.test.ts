import assert from "node:assert/strict";
import test from "node:test";
import {
  CredentialAccessError,
  HumanReauthentication,
  InMemoryCredentialAuditSink,
  InMemorySourceCredentialVault,
  SourceCredentialService,
} from "../src/credentials.js";

test("credential projection never exposes raw values", async () => {
  const vault = new InMemorySourceCredentialVault();
  const reference = await vault.put({ workspaceId: "test_fixture_workspace", sourceId: "test_fixture_source" }, {
    userId: "test_fixture_user@example.invalid",
    password: "test_fixture_secret",
  });
  const service = new SourceCredentialService(
    vault,
    new HumanReauthentication(),
    new InMemoryCredentialAuditSink(),
  );
  const projection = await service.project(
    { workspaceId: "test_fixture_workspace", sourceId: "test_fixture_source" },
    reference,
  );

  assert.equal(projection.userId.state, "available");
  assert.notEqual(projection.userId.masked, "test_fixture_user@example.invalid");
  assert.equal(projection.password.masked, "********");
  assert.equal(JSON.stringify(projection).includes("test_fixture_secret"), false);
});

test("reveal and copy require a Human's recent re-authentication and audit without secret values", async () => {
  let now = Date.parse("2026-07-16T00:00:00.000Z");
  const vault = new InMemorySourceCredentialVault();
  const reference = await vault.put({ workspaceId: "test_fixture_workspace", sourceId: "test_fixture_source" }, {
    userId: "test_fixture_user",
    password: "test_fixture_secret",
  });
  const audit = new InMemoryCredentialAuditSink();
  const reauthentication = new HumanReauthentication({ now: () => now, ttlMs: 1_000 });
  const service = new SourceCredentialService(
    vault,
    reauthentication,
    audit,
    () => new Date(now).toISOString(),
  );

  assert.throws(
    () =>
      service.reauthenticate({
        actorType: "user",
        actorId: "test_fixture_human",
        workspaceId: "test_fixture_workspace",
        sourceId: "test_fixture_source",
      }),
    (error: unknown) => {
      assert.ok(error instanceof CredentialAccessError);
      assert.equal(error.code, "reauthentication_required");
      return true;
    },
  );
  assert.throws(
    () =>
      service.reauthenticate({
        actorType: "agent",
        actorId: "test_fixture_agent",
        workspaceId: "test_fixture_workspace",
        sourceId: "test_fixture_source",
        reauthenticatedAt: now,
      }),
    CredentialAccessError,
  );

  const session = service.reauthenticate({
    actorType: "user",
    actorId: "test_fixture_human",
    workspaceId: "test_fixture_workspace",
    sourceId: "test_fixture_source",
    reauthenticatedAt: now,
  });
  assert.match(session.token, /^reauth_[0-9a-f]{64}$/);
  const revealed = await service.access({
    reference,
    workspaceId: "test_fixture_workspace",
    sourceId: "test_fixture_source",
    actorType: "user",
    actorId: "test_fixture_human",
    token: session.token,
    field: "password",
    action: "reveal",
  });
  assert.equal(revealed.value, "test_fixture_secret");
  assert.deepEqual(audit.events, [
    {
      workspaceId: "test_fixture_workspace",
      sourceId: "test_fixture_source",
      actorId: "test_fixture_human",
      action: "reveal",
      field: "password",
      occurredAt: "2026-07-16T00:00:00.000Z",
    },
  ]);
  assert.equal(JSON.stringify(audit.events).includes("test_fixture_secret"), false);

  await assert.rejects(
    service.access({
      reference,
      workspaceId: "test_fixture_other_workspace",
      sourceId: "test_fixture_source",
      actorType: "user",
      actorId: "test_fixture_human",
      token: session.token,
      field: "password",
      action: "reveal",
    }),
    (error: unknown) => {
      assert.ok(error instanceof CredentialAccessError);
      assert.equal(error.code, "reauthentication_required");
      return true;
    },
  );

  now += 1_001;
  await assert.rejects(
    service.access({
      reference,
      workspaceId: "test_fixture_workspace",
      sourceId: "test_fixture_source",
      actorType: "user",
      actorId: "test_fixture_human",
      token: session.token,
      field: "userId",
      action: "copy",
    }),
    (error: unknown) => {
      assert.ok(error instanceof CredentialAccessError);
      assert.equal(error.code, "reauthentication_expired");
      return true;
    },
  );

  const replacement = service.reauthenticate({
    actorType: "user",
    actorId: "test_fixture_human",
    workspaceId: "test_fixture_workspace",
    sourceId: "test_fixture_source",
    reauthenticatedAt: now,
  });
  const newest = service.reauthenticate({
    actorType: "user",
    actorId: "test_fixture_human",
    workspaceId: "test_fixture_workspace",
    sourceId: "test_fixture_source",
    reauthenticatedAt: now,
  });
  assert.throws(
    () =>
      reauthentication.assert(
        replacement.token,
        "test_fixture_human",
        "test_fixture_workspace",
        "test_fixture_source",
      ),
    CredentialAccessError,
  );
  assert.doesNotThrow(() =>
    reauthentication.assert(
      newest.token,
      "test_fixture_human",
      "test_fixture_workspace",
      "test_fixture_source",
    ),
  );
});

test("credential revocation requires re-authentication, clears the vault, and returns a value-free audit", async () => {
  const now = Date.parse("2026-07-18T00:00:00.000Z");
  const vault = new InMemorySourceCredentialVault();
  const scope = {
    workspaceId: "test_fixture_workspace",
    sourceId: "test_fixture_source",
  };
  const reference = await vault.put(scope, {
    userId: "test_fixture_user",
    password: "test_fixture_secret",
  });
  const audit = new InMemoryCredentialAuditSink();
  const reauthentication = new HumanReauthentication({ now: () => now });
  const service = new SourceCredentialService(
    vault,
    reauthentication,
    audit,
    () => new Date(now).toISOString(),
  );
  const session = service.reauthenticate({
    actorType: "user",
    actorId: "test_fixture_human",
    ...scope,
    reauthenticatedAt: now,
  });

  const event = await service.revokeCredential({
    reference,
    actorType: "user",
    actorId: "test_fixture_human",
    token: session.token,
    ...scope,
  });

  assert.equal(await vault.metadata(scope, reference), null);
  assert.deepEqual(event, {
    ...scope,
    actorId: "test_fixture_human",
    action: "revoke",
    field: "credential",
    occurredAt: "2026-07-18T00:00:00.000Z",
  });
  assert.deepEqual(audit.events, []);
  assert.throws(
    () =>
      reauthentication.assert(
        session.token,
        "test_fixture_human",
        scope.workspaceId,
        scope.sourceId,
      ),
    CredentialAccessError,
  );
});

test("credential revocation claims its re-authentication token before concurrent deletion", async () => {
  const now = Date.parse("2026-07-18T00:00:00.000Z");
  const vault = new InMemorySourceCredentialVault();
  const scope = {
    workspaceId: "test_fixture_workspace",
    sourceId: "test_fixture_source",
  };
  const reference = await vault.put(scope, {
    password: "test_fixture_secret",
  });
  const service = new SourceCredentialService(
    vault,
    new HumanReauthentication({ now: () => now }),
    new InMemoryCredentialAuditSink(),
    () => new Date(now).toISOString(),
  );
  const session = service.reauthenticate({
    actorType: "user",
    actorId: "test_fixture_human",
    ...scope,
    reauthenticatedAt: now,
  });
  const input = {
    reference,
    actorType: "user" as const,
    actorId: "test_fixture_human",
    token: session.token,
    ...scope,
  };

  const results = await Promise.allSettled([
    service.revokeCredential(input),
    service.revokeCredential(input),
  ]);

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof CredentialAccessError,
    ).length,
    1,
  );
  assert.equal(await vault.metadata(scope, reference), null);
});
