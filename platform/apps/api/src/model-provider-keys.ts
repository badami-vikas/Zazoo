/**
 * ModelProviderKeyStore — Settings → API Keys, backed by the SAME governed
 * secret mechanism DealPilot Source credentials already use (ADR-181).
 *
 * Residency: a model-provider API key is a secret the user typed, so it is
 * LOCAL PLANE ONLY. The key bytes go to `SourceCredentialVault` — in practice
 * the OS keyring (macOS Keychain / libsecret / Credential Manager) or the
 * AES-256-GCM `EncryptedFileSourceCredentialVault` under
 * `<BRIDGE_LOCAL_DIR>/credential-vault/`, whichever
 * `BRIDGE_DEALPILOT_CREDENTIAL_VAULT` names. In public-cloud mode the wired
 * vault refuses every operation, so this store fails closed exactly like
 * `dealpilot.createSource` does. Nothing here writes a key to Postgres,
 * Supabase, localStorage, a plain file, an error message, or a log line.
 *
 * What DOES live in the Local Plane state store is a *reference* — the opaque
 * vault handle plus a timestamp. A reference is not a secret: reading it
 * without the keyring/key yields nothing. That split is what lets the API read
 * the saved key once at boot (see wiring.ts) without keeping a plaintext copy
 * anywhere.
 *
 * No read path returns key bytes to a client. `list()` reports existence and
 * age only; the raw value is reachable exclusively from `read()`, which is
 * called by process wiring, never by a tRPC procedure.
 */
import type {
  SourceCredentialScope,
  SourceCredentialVault,
} from "@bridge/dealpilot";

const NAMESPACE = "model-provider-keys.v1";
const VERSION = 1;

/**
 * The provider slots Settings can configure. A slot exists only when the
 * process can actually DO something with the saved key — today that means
 * `wiring.ts` knows how to construct the provider from it at boot. Adding a
 * row here without the matching construction would be fabricated capability
 * (AP-021), so the two move together.
 */
export const MODEL_PROVIDER_KEY_SLOTS = [
  {
    id: "groq",
    label: "Groq",
    /** The environment variable that configures the same provider at boot. */
    envVar: "GROQ_API_KEY",
    description:
      "Low-latency cloud inference (Cloud Plane). Used for intent classification and cheap/default tier completions.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    description:
      "OpenRouter (Cloud Plane), default model Ox Alpha. Used for governed cloud-model calls that declare public data scope, e.g. Academics course-document summarization.",
  },
] as const;

export type ModelProviderKeyId = (typeof MODEL_PROVIDER_KEY_SLOTS)[number]["id"];

export function isModelProviderKeyId(value: string): value is ModelProviderKeyId {
  return MODEL_PROVIDER_KEY_SLOTS.some((slot) => slot.id === value);
}

/** Scope reuse: one credential per (Organization, provider slot). */
function scopeFor(
  organizationId: string,
  providerId: ModelProviderKeyId,
): SourceCredentialScope {
  return { organizationId, sourceId: `model-provider:${providerId}` };
}

interface StoredKeyRef {
  reference: string;
  updatedAt: string;
}

interface KeyAggregate {
  version: 1;
  providers: Record<string, StoredKeyRef>;
}

interface AtomicStatePort {
  read(organizationId: string, namespace: string): Promise<unknown | null>;
  update<T>(
    organizationId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => { state: unknown; result: T },
  ): Promise<T>;
}

function emptyState(): KeyAggregate {
  return { version: VERSION, providers: {} };
}

function parseState(value: unknown): KeyAggregate {
  if (value == null) return emptyState();
  if (
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== VERSION ||
    !("providers" in value) ||
    typeof value.providers !== "object" ||
    value.providers === null ||
    Array.isArray(value.providers)
  ) {
    throw new Error("Model-provider key storage is invalid or unsupported");
  }
  return value as KeyAggregate;
}

export interface ModelProviderKeyStatus {
  providerId: ModelProviderKeyId;
  label: string;
  description: string;
  envVar: string;
  /** A key is stored in the Local Plane vault for this slot. Never the value. */
  configured: boolean;
  /** ISO-8601 time the stored key was last written. Absent when unconfigured. */
  updatedAt?: string;
  /**
   * This process was started with the matching environment variable set. The
   * environment still wins at boot, so Settings reports it rather than
   * pretending a saved key would override it.
   */
  fromEnvironment: boolean;
  /**
   * The running process has this provider registered in its model router right
   * now. False with `configured: true` means "saved, not yet active — restart".
   */
  active: boolean;
}

export class ModelProviderKeyStore {
  readonly #state: AtomicStatePort;
  readonly #vault: SourceCredentialVault;
  readonly #now: () => string;

  constructor(deps: {
    state: AtomicStatePort;
    vault: SourceCredentialVault;
    now?: () => string;
  }) {
    this.#state = deps.state;
    this.#vault = deps.vault;
    this.#now = deps.now ?? (() => new Date().toISOString());
  }

  /** Stored references only — no vault access, so no keyring prompt. */
  async #references(organizationId: string): Promise<KeyAggregate> {
    return parseState(await this.#state.read(organizationId, NAMESPACE));
  }

  /**
   * Existence + age per slot. Never returns key bytes, not even masked ones:
   * a mask derived from the value is still a value-derived leak, and there is
   * nothing a user learns from `sk-…abcd` that `configured` does not tell them.
   */
  async list(
    organizationId: string,
    context: { env: NodeJS.ProcessEnv; activeProviderIds: ReadonlySet<string> },
  ): Promise<ModelProviderKeyStatus[]> {
    const aggregate = await this.#references(organizationId);
    return MODEL_PROVIDER_KEY_SLOTS.map((slot) => {
      const stored = aggregate.providers[slot.id];
      return {
        providerId: slot.id,
        label: slot.label,
        description: slot.description,
        envVar: slot.envVar,
        configured: Boolean(stored),
        ...(stored ? { updatedAt: stored.updatedAt } : {}),
        fromEnvironment: Boolean(context.env[slot.envVar]?.trim()),
        active: context.activeProviderIds.has(slot.id),
      };
    });
  }

  /**
   * Write the key to the vault first, then publish its reference. That order
   * means a crash between the two leaves an orphaned vault entry (invisible,
   * harmless) rather than a dangling reference to a secret that was never
   * stored. The previous entry is deleted only after the new reference is
   * durably published.
   */
  async save(
    organizationId: string,
    providerId: ModelProviderKeyId,
    apiKey: string,
  ): Promise<void> {
    const scope = scopeFor(organizationId, providerId);
    const reference = this.#vault.reserve(scope);
    await this.#vault.write(scope, reference, { password: apiKey });
    const updatedAt = this.#now();
    let previous: string | undefined;
    try {
      previous = await this.#state.update(
        organizationId,
        NAMESPACE,
        emptyState(),
        (current) => {
          const aggregate = parseState(current);
          const prior = aggregate.providers[providerId]?.reference;
          aggregate.providers[providerId] = { reference, updatedAt };
          return { state: aggregate, result: prior };
        },
      );
    } catch (error) {
      // The reference never became visible; do not leave the secret behind.
      await this.#vault.delete(scope, reference).catch(() => {});
      throw error;
    }
    if (previous && previous !== reference) {
      await this.#vault.delete(scope, previous).catch(() => {});
    }
  }

  /** Unpublish the reference, then delete the secret. */
  async clear(
    organizationId: string,
    providerId: ModelProviderKeyId,
  ): Promise<boolean> {
    const removed = await this.#state.update(
      organizationId,
      NAMESPACE,
      emptyState(),
      (current) => {
        const aggregate = parseState(current);
        const prior = aggregate.providers[providerId]?.reference;
        delete aggregate.providers[providerId];
        return { state: aggregate, result: prior };
      },
    );
    if (!removed) return false;
    await this.#vault.delete(scopeFor(organizationId, providerId), removed);
    return true;
  }

  /**
   * The ONLY path that yields key bytes. Called by process wiring at boot to
   * construct the provider; never exposed through tRPC. Returns null when no
   * reference is published, without touching the vault at all — so a
   * deployment that never saved a key never triggers a keyring prompt.
   */
  async read(
    organizationId: string,
    providerId: ModelProviderKeyId,
  ): Promise<string | null> {
    const stored = (await this.#references(organizationId)).providers[providerId];
    if (!stored) return null;
    return this.#vault.read(
      scopeFor(organizationId, providerId),
      stored.reference,
      "password",
    );
  }
}
