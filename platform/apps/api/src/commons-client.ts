/**
 * HttpCommonsClient — fetch adapter binding @bridge/core's `CommonsRegistry`
 * port to the Commons HTTP contract (services/commons/src/server.ts). Same
 * seam discipline as ModelProvider/PackageStore: consumers depend on the
 * port; the Bridge Cloud swap is COMMONS_URL config only.
 *
 * PKG-2 (Month-6) supply-chain trust lives at THIS transport seam:
 *  - TLS-by-default — the constructor rejects a non-loopback plaintext
 *    COMMONS_URL (assertCommonsUrlTls).
 *  - verify-on-install — every fetched package entry's publisher signature is
 *    verified with node:crypto ed25519 before it is handed back, so an
 *    UNSIGNED or ALTERED manifest is rejected at the boundary (any consumer —
 *    install flow, Learning Agent — is protected without repeating the check).
 * The ed25519 primitive is bound here (apps/api may use node:crypto); @bridge/
 * core stays zero-runtime-deps and supplies only the pure verification policy.
 */
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import {
  CommonsPublishRejectedError,
  assertCommonsUrlTls,
  toSignedEnvelope,
  verifyManifestSignature,
  type CommonsListQuery,
  type CommonsListResult,
  type CommonsPackageDetail,
  type CommonsPackageEntry,
  type CommonsRegistry,
  type ManifestVerificationFailure,
  type PackageManifest,
  type SignatureVerifier,
} from "@bridge/core";

export const DEFAULT_COMMONS_URL = "http://localhost:4780";

export function commonsUrlFromEnv(): string {
  return process.env.COMMONS_URL ?? DEFAULT_COMMONS_URL;
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

/** A fetched Commons entry failed signature verification (PKG-2) — unsigned,
 * altered, or signed by an untrusted key. Install/consume must not proceed. */
export class CommonsSignatureError extends Error {
  readonly reason: ManifestVerificationFailure;
  constructor(name: string, version: string, reason: ManifestVerificationFailure) {
    super(`commons: refusing ${name}@${version} — manifest signature ${reason} (PKG-2 verify-on-install)`);
    this.name = "CommonsSignatureError";
    this.reason = reason;
  }
}

export interface HttpCommonsClientOptions {
  /** When set, a fetched entry's signing key MUST be in this allowlist (a
   * valid signature from an unknown key is rejected). When omitted, any
   * cryptographically-valid signature is accepted (integrity-only / TOFU —
   * still rejects unsigned and altered manifests). */
  trustedPublicKeys?: readonly string[];
  /** Escape hatch to disable verification (e.g. a legacy unsigned registry in a
   * controlled test). Defaults to true — verification is ON by default. */
  verifySignatures?: boolean;
}

export class HttpCommonsClient implements CommonsRegistry {
  readonly #baseUrl: string;
  readonly #verify: boolean;
  readonly #trustedPublicKeys: readonly string[] | undefined;

  constructor(baseUrl: string = commonsUrlFromEnv(), options: HttpCommonsClientOptions = {}) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    // PKG-2 TLS-by-default: reject a remote plaintext registry up front.
    assertCommonsUrlTls(this.#baseUrl);
    this.#verify = options.verifySignatures ?? true;
    this.#trustedPublicKeys = options.trustedPublicKeys;
  }

  /** PKG-2 verify-on-install: reject an unsigned or altered fetched entry. */
  #verifyEntry(entry: CommonsPackageEntry): void {
    if (!this.#verify) return;
    const envelope = entry.signature ? toSignedEnvelope(entry.manifest, entry.signature) : null;
    const result = verifyManifestSignature(
      envelope,
      ed25519ManifestVerifier,
      this.#trustedPublicKeys ? { trustedPublicKeys: this.#trustedPublicKeys } : {},
    );
    if (!result.valid) throw new CommonsSignatureError(entry.name, entry.version, result.reason);
  }

  async listAvailable(query: CommonsListQuery = {}): Promise<CommonsListResult> {
    const params = new URLSearchParams();
    if (query.kind !== undefined) params.set("kind", query.kind);
    if (query.tag !== undefined) params.set("tag", query.tag);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.offset !== undefined) params.set("offset", String(query.offset));
    const qs = params.size > 0 ? `?${params.toString()}` : "";
    const res = await fetch(`${this.#baseUrl}/v1/packages${qs}`);
    if (!res.ok) throw new Error(`commons list failed: ${res.status}`);
    return (await res.json()) as CommonsListResult;
  }

  async get(name: string): Promise<CommonsPackageDetail | null> {
    const res = await fetch(`${this.#baseUrl}/v1/packages/${encodeURIComponent(name)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`commons get failed: ${res.status}`);
    const detail = (await res.json()) as CommonsPackageDetail;
    this.#verifyEntry(detail.latest);
    return detail;
  }

  async getVersion(name: string, version: string): Promise<CommonsPackageEntry | null> {
    const res = await fetch(`${this.#baseUrl}/v1/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`commons getVersion failed: ${res.status}`);
    const entry = (await res.json()) as CommonsPackageEntry;
    this.#verifyEntry(entry);
    return entry;
  }

  async publish(manifest: PackageManifest, tags: string[] = []): Promise<{ name: string; version: string }> {
    const res = await fetch(`${this.#baseUrl}/v1/packages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, tags }),
    });
    if (res.status === 201) return (await res.json()) as { name: string; version: string };
    const body = (await res.json().catch(() => ({}))) as { message?: string; offendingPaths?: string[] };
    if (res.status === 422) {
      throw new CommonsPublishRejectedError(body.message ?? "workspace data rejected", body.offendingPaths ?? []);
    }
    throw new CommonsPublishRejectedError(body.message ?? `publish failed: ${res.status}`);
  }
}
