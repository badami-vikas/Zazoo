import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySourceCredentialVault } from "@bridge/dealpilot";
import { ModelProviderKeyStore } from "../src/model-provider-keys.js";
import { PILOT_ORGANIZATION } from "../src/wiring.js";

class TestStatePort {
  readonly rows = new Map<string, unknown>();

  async read(organizationId: string, namespace: string): Promise<unknown | null> {
    return structuredClone(this.rows.get(JSON.stringify([organizationId, namespace])) ?? null);
  }

  async update<T>(
    organizationId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => { state: unknown; result: T },
  ): Promise<T> {
    const key = JSON.stringify([organizationId, namespace]);
    const current = structuredClone(this.rows.get(key) ?? initialState);
    const mutation = reduce(current);
    this.rows.set(key, structuredClone(mutation.state));
    return mutation.result;
  }
}

const KEY = "gsk_live_never_leaves_the_vault_0123456789";

test("a saved model-provider key reaches the vault and never the state store", async () => {
  const state = new TestStatePort();
  const vault = new InMemorySourceCredentialVault();
  const store = new ModelProviderKeyStore({ state, vault });

  await store.save(PILOT_ORGANIZATION, "groq", KEY);

  // The Local Plane state row holds a reference and a timestamp — no key bytes.
  const persisted = JSON.stringify([...state.rows.values()]);
  assert.equal(persisted.includes(KEY), false);
  // The vault is where the secret actually landed.
  assert.equal(
    JSON.stringify([...vault.entries.values()]).includes(KEY),
    true,
  );
  // And that is the ONLY read path that yields it.
  assert.equal(await store.read(PILOT_ORGANIZATION, "groq"), KEY);
});

test("list reports existence, age, and activation — never the key or a mask of it", async () => {
  const state = new TestStatePort();
  const vault = new InMemorySourceCredentialVault();
  const store = new ModelProviderKeyStore({ state, vault });

  const before = await store.list(PILOT_ORGANIZATION, {
    env: {},
    activeProviderIds: new Set<string>(),
  });
  assert.equal(before.length, 1);
  assert.deepEqual(
    { configured: before[0]!.configured, active: before[0]!.active, env: before[0]!.fromEnvironment },
    { configured: false, active: false, env: false },
  );

  await store.save(PILOT_ORGANIZATION, "groq", KEY);
  const after = await store.list(PILOT_ORGANIZATION, {
    env: { GROQ_API_KEY: "an-environment-key" },
    activeProviderIds: new Set<string>(),
  });
  assert.equal(after[0]!.configured, true);
  assert.equal(after[0]!.fromEnvironment, true);
  // Saved but not registered in this process: the honest "restart to activate" state.
  assert.equal(after[0]!.active, false);
  assert.equal(typeof after[0]!.updatedAt, "string");
  assert.equal(JSON.stringify(after).includes(KEY), false);
  assert.equal(JSON.stringify(after).includes(KEY.slice(-4)), false);

  const active = await store.list(PILOT_ORGANIZATION, {
    env: {},
    activeProviderIds: new Set(["groq"]),
  });
  assert.equal(active[0]!.active, true);
});

test("replacing a key deletes the superseded vault entry; clearing removes both halves", async () => {
  const state = new TestStatePort();
  const vault = new InMemorySourceCredentialVault();
  const store = new ModelProviderKeyStore({ state, vault });

  await store.save(PILOT_ORGANIZATION, "groq", KEY);
  await store.save(PILOT_ORGANIZATION, "groq", "gsk_replacement");
  assert.equal(vault.entries.size, 1);
  assert.equal(JSON.stringify([...vault.entries.values()]).includes(KEY), false);
  assert.equal(await store.read(PILOT_ORGANIZATION, "groq"), "gsk_replacement");

  assert.equal(await store.clear(PILOT_ORGANIZATION, "groq"), true);
  assert.equal(vault.entries.size, 0);
  assert.equal(await store.read(PILOT_ORGANIZATION, "groq"), null);
  // Idempotent: clearing an unconfigured slot is not an error.
  assert.equal(await store.clear(PILOT_ORGANIZATION, "groq"), false);
});

test("a failed reference publish does not leave the secret behind in the vault", async () => {
  const state = new TestStatePort();
  const vault = new InMemorySourceCredentialVault();
  const store = new ModelProviderKeyStore({
    state: {
      read: (organizationId, namespace) => state.read(organizationId, namespace),
      update: async () => {
        throw new Error("local state write failed");
      },
    },
    vault,
  });

  await assert.rejects(() => store.save(PILOT_ORGANIZATION, "groq", KEY));
  assert.equal(vault.entries.size, 0);
});
