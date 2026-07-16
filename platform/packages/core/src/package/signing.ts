/**
 * Commons supply-chain trust (PKG-2, roadmap Month-6). Manifest signing +
 * verification, TLS-by-default, and the community-origin trust floor.
 *
 * ZERO-RUNTIME-DEPS DISCIPLINE: @bridge/core must not import `node:crypto`
 * (real I/O lives at the seam — services/commons + apps/api). So this module
 * provides ONLY the pure pieces both sides agree on:
 *   - the `SignedManifestEnvelope` wire shape,
 *   - `canonicalizeManifest()` — the deterministic byte string that is signed
 *     and verified (identical on publisher and installer, independent of key
 *     order / whitespace),
 *   - `verifyManifestSignature()` — the pure verification POLICY, taking an
 *     injected `SignatureVerifier` (the actual ed25519 check, bound to
 *     `node:crypto` at the seam) plus an optional trusted-key allowlist,
 *   - `assertCommonsUrlTls()` — the TLS-by-default rule (no crypto needed).
 *
 * The signer (publish side) and the `SignatureVerifier` (install side) live in
 * services/commons / apps/api respectively; both canonicalize via THIS module
 * so a manifest signed by the publisher verifies byte-for-byte on install.
 */
import type { PackageManifest } from "./types.js";

/** The only signature algorithm v1 accepts (small, fast, no parameters to get
 * wrong — unlike RSA/ECDSA curve/padding choices). */
export type ManifestSignatureAlgorithm = "ed25519";

/**
 * Detached signature metadata over a manifest — everything needed to verify a
 * manifest EXCEPT the manifest itself. Carried on a `CommonsPackageEntry`
 * (`signature?`) so the registry can serve the signature alongside the
 * manifest, and composed into a `SignedManifestEnvelope` for verification.
 */
export interface ManifestSignature {
  /** base64 detached signature over canonicalizeManifest(manifest). */
  signature: string;
  publicKey: string;
  algorithm: ManifestSignatureAlgorithm;
  /** ISO-8601 publish-time claim — NOT part of the signed bytes. */
  signedAt: string;
}

/**
 * A published package's signed envelope — the manifest plus a detached
 * signature over `canonicalizeManifest(manifest)`. `publicKey` is the
 * publisher's key (base64 raw or PEM, opaque to this module — the injected
 * verifier interprets it); trust in that key is decided by the installer's
 * allowlist, NOT by the envelope asserting it (an envelope can lie).
 */
export interface SignedManifestEnvelope extends ManifestSignature {
  manifest: PackageManifest;
}

/** Compose a verifiable envelope from a manifest and its detached signature. */
export function toSignedEnvelope(manifest: PackageManifest, signature: ManifestSignature): SignedManifestEnvelope {
  return { manifest, ...signature };
}

/**
 * Deterministic canonical JSON for a manifest — the exact byte string that is
 * signed and verified. Object keys are emitted in sorted order recursively so
 * two structurally-equal manifests always canonicalize identically regardless
 * of key insertion order; arrays keep their order (order is semantic for
 * capabilities/permissions). Pure, no crypto. Kept deliberately small (no
 * external JSON-canonicalization dependency — this package is zero-deps).
 */
export function canonicalizeManifest(manifest: PackageManifest): string {
  return canonicalizeJson(manifest);
}

/** Deterministic JSON used by every Commons hash/signature boundary. */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`).join(",")}}`;
}

/** The ed25519 check, injected from the seam (node:crypto). Returns true iff
 * `signatureB64` is a valid signature over `data` for `publicKey`. MUST NOT
 * throw for a bad signature — return false (a thrown crypto error is coerced
 * to `invalid_signature` by verifyManifestSignature). */
export type SignatureVerifier = (data: string, signatureB64: string, publicKey: string) => boolean;

export type ManifestVerificationFailure =
  /** No envelope/signature present at all — an unsigned manifest. */
  | "missing_signature"
  /** Signature does not match the manifest bytes (tampered or wrong key). */
  | "invalid_signature"
  /** Signature is valid but the signing key is not on the installer's allowlist. */
  | "untrusted_key"
  /** Envelope declared an algorithm this verifier does not accept. */
  | "unsupported_algorithm";

export type ManifestVerificationResult =
  | { valid: true }
  | { valid: false; reason: ManifestVerificationFailure };

export interface VerifyManifestOptions {
  /** When provided, the envelope's publicKey MUST be in this allowlist — a
   * valid signature from an UNKNOWN key is rejected as `untrusted_key`. When
   * omitted, any cryptographically-valid signature is accepted (TOFU). */
  trustedPublicKeys?: readonly string[];
}

/**
 * Verify a signed manifest envelope. Pure POLICY over an injected crypto
 * primitive: checks the algorithm, the signature against
 * `canonicalizeManifest(envelope.manifest)`, and (optionally) the key
 * allowlist. Never throws — a verifier that throws is treated as an invalid
 * signature (fail-closed).
 */
export function verifyManifestSignature(
  envelope: SignedManifestEnvelope | null | undefined,
  verify: SignatureVerifier,
  options: VerifyManifestOptions = {},
): ManifestVerificationResult {
  if (!envelope || typeof envelope.signature !== "string" || envelope.signature.length === 0) {
    return { valid: false, reason: "missing_signature" };
  }
  if (envelope.algorithm !== "ed25519") {
    return { valid: false, reason: "unsupported_algorithm" };
  }
  const data = canonicalizeManifest(envelope.manifest);
  let ok = false;
  try {
    ok = verify(data, envelope.signature, envelope.publicKey);
  } catch {
    ok = false; // fail-closed: a crypto error is a failed verification, never a pass
  }
  if (!ok) return { valid: false, reason: "invalid_signature" };
  if (options.trustedPublicKeys && !options.trustedPublicKeys.includes(envelope.publicKey)) {
    return { valid: false, reason: "untrusted_key" };
  }
  return { valid: true };
}

export class CommonsInsecureTransportError extends Error {
  constructor(url: string) {
    super(
      `commons: refusing insecure transport for COMMONS_URL "${url}" — TLS (https) is required for any non-loopback ` +
        `Commons host (PKG-2 TLS-by-default). Use https, or a localhost/127.0.0.1 URL for local development.`,
    );
    this.name = "CommonsInsecureTransportError";
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

/**
 * TLS-by-default (PKG-2): a Commons URL must be https UNLESS it targets a
 * loopback host (localhost/127.0.0.1), which is the only case where plain http
 * is allowed (local-first dev service). Throws CommonsInsecureTransportError
 * for a remote http URL. Returns the parsed URL on success. Pure — no I/O.
 */
export function assertCommonsUrlTls(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CommonsInsecureTransportError(url);
  }
  if (parsed.protocol === "https:") return parsed;
  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) return parsed;
  throw new CommonsInsecureTransportError(url);
}
