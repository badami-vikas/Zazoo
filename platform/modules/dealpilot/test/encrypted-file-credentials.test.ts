import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EncryptedFileCredentialError,
  EncryptedFileSourceCredentialVault,
} from "../src/encrypted-file-credentials.js";

const scope = {
  organizationId: "10000000-0000-4000-8000-000000000101",
  sourceId: "20000000-0000-4000-8000-000000000101",
};
const current = { id: "key-2026-07", key: Buffer.alloc(32, 0x11) };
const previous = { id: "key-2026-06", key: Buffer.alloc(32, 0x22) };

async function withVaultDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "bridge-vault-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("encrypted file vault survives restart without persisting credential plaintext", async () => {
  await withVaultDirectory(async (directory) => {
    const first = new EncryptedFileSourceCredentialVault({
      directory,
      current,
    });
    const reference = await first.put(scope, {
      userId: "owner@test.invalid",
      password: "test-fixture-password",
    });

    const [name] = await readdir(directory);
    assert.ok(name);
    const raw = await readFile(join(directory, name), "utf8");
    assert.equal(raw.includes("owner@test.invalid"), false);
    assert.equal(raw.includes("test-fixture-password"), false);
    assert.equal((await stat(join(directory, name))).mode & 0o077, 0);

    const restarted = new EncryptedFileSourceCredentialVault({
      directory,
      current,
    });
    assert.equal(await restarted.read(scope, reference, "userId"), "owner@test.invalid");
    assert.equal(
      await restarted.read(scope, reference, "password"),
      "test-fixture-password",
    );
    assert.deepEqual(await restarted.metadata(scope, reference), {
      userId: { state: "available", masked: "o****@test.invalid" },
      password: { state: "available", masked: "********" },
    });

    await restarted.delete(scope, reference);
    assert.equal(await restarted.metadata(scope, reference), null);
  });
});

test("encrypted file vault rejects wrong scope and wrong encryption key", async () => {
  await withVaultDirectory(async (directory) => {
    const vault = new EncryptedFileSourceCredentialVault({ directory, current });
    const reference = await vault.put(scope, { password: "test-fixture-password" });

    await assert.rejects(
      () =>
        vault.read(
          { ...scope, sourceId: "20000000-0000-4000-8000-000000000102" },
          reference,
          "password",
        ),
      (error: unknown) =>
        error instanceof EncryptedFileCredentialError &&
        error.code === "scope_mismatch",
    );

    const wrongKey = new EncryptedFileSourceCredentialVault({
      directory,
      current: { ...current, key: Buffer.alloc(32, 0x33) },
    });
    await assert.rejects(
      () => wrongKey.read(scope, reference, "password"),
      (error: unknown) =>
        error instanceof EncryptedFileCredentialError &&
        error.code === "decryption_failed",
    );
  });
});

test("encrypted file vault explicitly rotates previous-key entries", async () => {
  await withVaultDirectory(async (directory) => {
    const oldVault = new EncryptedFileSourceCredentialVault({
      directory,
      current: previous,
    });
    const first = await oldVault.put(scope, {
      password: "test-fixture-password-one",
    });
    const second = await oldVault.put(
      { ...scope, sourceId: "20000000-0000-4000-8000-000000000102" },
      { password: "test-fixture-password-two" },
    );

    const rotating = new EncryptedFileSourceCredentialVault({
      directory,
      current,
      previous,
    });
    assert.equal(await rotating.rotateAll(), 2);

    const currentOnly = new EncryptedFileSourceCredentialVault({
      directory,
      current,
    });
    assert.equal(
      await currentOnly.read(scope, first, "password"),
      "test-fixture-password-one",
    );
    assert.equal(
      await currentOnly.read(
        { ...scope, sourceId: "20000000-0000-4000-8000-000000000102" },
        second,
        "password",
      ),
      "test-fixture-password-two",
    );
    for (const name of await readdir(directory)) {
      const envelope = JSON.parse(
        await readFile(join(directory, name), "utf8"),
      ) as { keyId?: unknown };
      assert.equal(envelope.keyId, current.id);
    }
  });
});
