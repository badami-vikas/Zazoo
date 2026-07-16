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
  const reference = await vault.put("test_fixture_source", {
    userId: "test_fixture_user@example.invalid",
    password: "test_fixture_secret",
  });
  const service = new SourceCredentialService(
    vault,
    new HumanReauthentication(),
    new InMemoryCredentialAuditSink(),
  );
  const projection = await service.project(reference);

  assert.equal(projection.userId.state, "available");
  assert.notEqual(projection.userId.masked, "test_fixture_user@example.invalid");
  assert.equal(projection.password.masked, "********");
  assert.equal(JSON.stringify(projection).includes("test_fixture_secret"), false);
});

test("reveal and copy require a Human's recent re-authentication and audit without secret values", async () => {
  let now = Date.parse("2026-07-16T00:00:00.000Z");
  const vault = new InMemorySourceCredentialVault();
  const reference = await vault.put("test_fixture_source", {
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
        sourceId: "test_fixture_source",
        reauthenticatedAt: now,
      }),
    CredentialAccessError,
  );

  const session = service.reauthenticate({
    actorType: "user",
    actorId: "test_fixture_human",
    sourceId: "test_fixture_source",
    reauthenticatedAt: now,
  });
  const revealed = await service.access({
    reference,
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
      sourceId: "test_fixture_source",
      actorId: "test_fixture_human",
      action: "reveal",
      field: "password",
      occurredAt: "2026-07-16T00:00:00.000Z",
    },
  ]);
  assert.equal(JSON.stringify(audit.events).includes("test_fixture_secret"), false);

  now += 1_001;
  await assert.rejects(
    service.access({
      reference,
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
});
