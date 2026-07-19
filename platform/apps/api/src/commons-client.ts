/**
 * HttpCommonsClient — fetch adapter binding @bridge/core's `CommonsRegistry`
 * port to the Commons HTTP contract (services/commons/src/server.ts). Same
 * seam discipline as ModelProvider/ModuleStore: consumers depend on the
 * port; the Bridge Cloud swap is COMMONS_URL config only.
 *
 * PKG-2 (Month-6) supply-chain trust lives at THIS transport seam:
 *  - TLS-by-default — the constructor rejects a non-loopback plaintext
 *    COMMONS_URL (assertCommonsUrlTls).
 *  - verify-on-install — every fetched module entry's publisher signature is
 *    verified with node:crypto ed25519 before it is handed back, so an
 *    UNSIGNED or ALTERED manifest is rejected at the boundary (any consumer —
 *    install flow, Learning Agent — is protected without repeating the check).
 * The ed25519 primitive is bound here (apps/api may use node:crypto); @bridge/
 * core stays zero-runtime-deps and supplies only the pure verification policy.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import {
  CommonsPublishRejectedError,
  assertCommonsUrlTls,
  verifyCommonsEntry,
  verifyCommonsEntryContent,
  type CommonsListQuery,
  type CommonsListResult,
  type CommonsModuleDetail,
  type CommonsModuleEntry,
  type CommonsEntryVerificationFailure,
  type CommonsProvenance,
  type CommonsRegistry,
  type ModuleManifest,
  type SignatureVerifier,
} from "@bridge/core";

export const DEFAULT_COMMONS_URL = "http://localhost:4780";

export function commonsUrlFromEnv(): string {
  return process.env.COMMONS_URL ?? DEFAULT_COMMONS_URL;
}

export function trustedCommonsPublicKeysFromEnv(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const keys: string[] = [];
  if (env.COMMONS_TRUSTED_PUBLIC_KEY_PEM?.trim()) {
    keys.push(env.COMMONS_TRUSTED_PUBLIC_KEY_PEM);
  }
  if (env.COMMONS_TRUSTED_PUBLIC_KEYS_JSON !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.COMMONS_TRUSTED_PUBLIC_KEYS_JSON);
    } catch {
      throw new Error("COMMONS_TRUSTED_PUBLIC_KEYS_JSON must be a JSON array of PEM public keys");
    }
    if (!Array.isArray(parsed) || parsed.some((key) => typeof key !== "string" || key.trim() === "")) {
      throw new Error("COMMONS_TRUSTED_PUBLIC_KEYS_JSON must be a JSON array of PEM public keys");
    }
    keys.push(...parsed);
  }
  return [...new Set(keys.map((key) =>
    createPublicKey(key).export({ type: "spki", format: "pem" }).toString()
  ))];
}

/** ed25519 verification bound to node:crypto — PEM public key, base64 raw
 * signature, UTF-8 signed bytes (matches the Commons signer in
 * services/commons/src/signing.ts). Fails closed: a malformed key/signature is
 * a failed verification, never a throw that could be mistaken for a pass. */
const ed25519ManifestVerifier: SignatureVerifier = (data, signatureB64, publicKeyPem) => {
  try {
    return cryptoVerify(null, Buffer.from(data, "utf8"), createPublicKey(publicKeyPem), Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
};

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/** A fetched Commons entry failed supply-chain verification. */
export class CommonsSignatureError extends Error {
  readonly reason: CommonsEntryVerificationFailure;
  constructor(name: string, version: string, reason: CommonsEntryVerificationFailure) {
    super(`commons: refusing ${name}@${version} — trust verification ${reason}`);
    this.name = "CommonsSignatureError";
    this.reason = reason;
  }
}

export class CommonsResponseMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`commons: refusing response substitution — requested ${expected}, received ${actual}`);
    this.name = "CommonsResponseMismatchError";
  }
}

/** Install seam repeats the deterministic content/scan/provenance check. */
export function assertCommonsEntryContentTrusted(entry: CommonsModuleEntry): void {
  const result = verifyCommonsEntryContent(entry, sha256);
  if (!result.valid) throw new CommonsSignatureError(entry.name, entry.version, result.reason);
}

export interface HttpCommonsClientOptions {
  /** A fetched entry's signing key MUST be in this allowlist. An omitted or
   * empty allowlist rejects every signed entry as untrusted. */
  trustedPublicKeys?: readonly string[];
  /** Curated publisher credential. Read-only clients leave this unset. */
  publishToken?: string;
  /** Escape hatch to disable verification (e.g. a legacy unsigned registry in a
   * controlled test). Defaults to true — verification is ON by default. */
  verifySignatures?: boolean;
}

export class HttpCommonsClient implements CommonsRegistry {
  readonly #baseUrl: string;
  readonly #verify: boolean;
  readonly #trustedPublicKeys: readonly string[];
  readonly #publishToken: string | undefined;

  constructor(baseUrl: string = commonsUrlFromEnv(), options: HttpCommonsClientOptions = {}) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    // PKG-2 TLS-by-default: reject a remote plaintext registry up front.
    assertCommonsUrlTls(this.#baseUrl);
    this.#verify = options.verifySignatures ?? true;
    this.#trustedPublicKeys = (options.trustedPublicKeys ?? []).map((key) =>
      createPublicKey(key).export({ type: "spki", format: "pem" }).toString()
    );
    this.#publishToken = options.publishToken;
  }

  /** PKG-2 verify-on-install: reject an unsigned or altered fetched entry. */
  #verifyEntry(entry: CommonsModuleEntry): void {
    if (!this.#verify) return;
    const result = verifyCommonsEntry(
      entry,
      sha256,
      ed25519ManifestVerifier,
      { trustedPublicKeys: this.#trustedPublicKeys },
    );
    if (!result.valid) throw new CommonsSignatureError(entry.name, entry.version, result.reason);
  }

  async listAvailable(query: CommonsListQuery = {}): Promise<CommonsListResult> {
    const params = new URLSearchParams();
    if (query.kind !== undefined) params.set("kind", query.kind);
    if (query.tag !== undefined) params.set("tag", query.tag);
    if (query.search !== undefined) params.set("search", query.search);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.offset !== undefined) params.set("offset", String(query.offset));
    const qs = params.size > 0 ? `?${params.toString()}` : "";
    const res = await fetch(`${this.#baseUrl}/v1/modules${qs}`);
    if (!res.ok) throw new Error(`commons list failed: ${res.status}`);
    return (await res.json()) as CommonsListResult;
  }

  async get(name: string): Promise<CommonsModuleDetail | null> {
    const res = await fetch(`${this.#baseUrl}/v1/modules/${encodeURIComponent(name)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`commons get failed: ${res.status}`);
    const detail = (await res.json()) as CommonsModuleDetail;
    this.#verifyEntry(detail.latest);
    if (detail.name !== name || detail.latest.name !== name) {
      throw new CommonsResponseMismatchError(name, `${detail.name}/${detail.latest.name}`);
    }
    return detail;
  }

  async getVersion(name: string, version: string): Promise<CommonsModuleEntry | null> {
    const res = await fetch(`${this.#baseUrl}/v1/modules/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`commons getVersion failed: ${res.status}`);
    const entry = (await res.json()) as CommonsModuleEntry;
    this.#verifyEntry(entry);
    if (entry.name !== name || entry.version !== version) {
      throw new CommonsResponseMismatchError(`${name}@${version}`, `${entry.name}@${entry.version}`);
    }
    return entry;
  }

  async publish(
    manifest: ModuleManifest,
    options: { tags?: string[]; provenance: CommonsProvenance; expectedContentHash?: string },
  ): Promise<{ name: string; version: string; contentHash: string }> {
    const res = await fetch(`${this.#baseUrl}/v1/modules`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.#publishToken ? { authorization: `Bearer ${this.#publishToken}` } : {}),
      },
      body: JSON.stringify({
        manifest,
        tags: options.tags ?? [],
        provenance: options.provenance,
        ...(options.expectedContentHash ? { expectedContentHash: options.expectedContentHash } : {}),
      }),
    });
    if (res.status === 201) {
      return (await res.json()) as { name: string; version: string; contentHash: string };
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string; offendingPaths?: string[] };
    if (res.status === 422) {
      throw new CommonsPublishRejectedError(body.message ?? "organization data rejected", body.offendingPaths ?? []);
    }
    throw new CommonsPublishRejectedError(body.message ?? `publish failed: ${res.status}`);
  }
}
