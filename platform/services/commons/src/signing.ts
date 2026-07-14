/**
 * Commons crypto binding at the service seam. @bridge/core stays pure and
 * zero-runtime-deps, so the node:crypto ed25519 implementation lives here while
 * both publisher and installer share core's canonical manifest bytes.
 */
import crypto from "node:crypto";
import { canonicalizeManifest, type ManifestSignature, type PackageManifest, type SignatureVerifier } from "@bridge/core";

export interface CommonsSigningKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

export function resolveCommonsSigningKeyPair(env: NodeJS.ProcessEnv = process.env): CommonsSigningKeyPair {
  if (env.COMMONS_SIGNING_PRIVATE_KEY_PEM && env.COMMONS_SIGNING_PUBLIC_KEY_PEM) {
    return {
      privateKeyPem: env.COMMONS_SIGNING_PRIVATE_KEY_PEM,
      publicKeyPem: env.COMMONS_SIGNING_PUBLIC_KEY_PEM,
    };
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  if (env.NODE_ENV !== "test") {
    console.warn("commons: generated ephemeral signing key; clients must fetch /v1/signing-key");
  }
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

export function signManifest(manifest: PackageManifest, keyPair: CommonsSigningKeyPair): ManifestSignature {
  const data = canonicalizeManifest(manifest);
  return {
    signature: crypto.sign(null, Buffer.from(data, "utf8"), crypto.createPrivateKey(keyPair.privateKeyPem)).toString("base64"),
    publicKey: keyPair.publicKeyPem,
    algorithm: "ed25519",
    signedAt: new Date().toISOString(),
  };
}

export const ed25519ManifestVerifier: SignatureVerifier = (data, sigB64, publicKeyPem) => {
  try {
    return crypto.verify(null, Buffer.from(data, "utf8"), crypto.createPublicKey(publicKeyPem), Buffer.from(sigB64, "base64"));
  } catch {
    return false;
  }
};
