/**
 * Commons crypto binding at the service seam. @bridge/core stays pure and
 * zero-runtime-deps, so the node:crypto ed25519 implementation lives here while
 * both publisher and installer share core's canonical manifest bytes.
 */
import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  canonicalizeCommonsSignedPayload,
  canonicalizeManifest,
  commonsPackageContent,
  type CommonsPackageEntry,
  type ManifestSignature,
  type PackageManifest,
  type SignatureVerifier,
} from "@bridge/core";

export interface CommonsSigningKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

function validateKeyPair(keyPair: CommonsSigningKeyPair): CommonsSigningKeyPair {
  const privateKey = crypto.createPrivateKey(keyPair.privateKeyPem);
  const suppliedPublicKeyObject = crypto.createPublicKey(keyPair.publicKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519" || suppliedPublicKeyObject.asymmetricKeyType !== "ed25519") {
    throw new Error("commons signing keys must be Ed25519");
  }
  const derivedPublicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const suppliedPublicKey = suppliedPublicKeyObject.export({ type: "spki", format: "pem" }).toString();
  if (derivedPublicKey !== suppliedPublicKey) {
    throw new Error("commons signing private/public keys do not match");
  }
  return { privateKeyPem: keyPair.privateKeyPem, publicKeyPem: suppliedPublicKey };
}

function readPersistedKeyPair(keyFilePath: string): CommonsSigningKeyPair {
  const parsed = JSON.parse(readFileSync(keyFilePath, "utf8")) as Partial<CommonsSigningKeyPair>;
  if (typeof parsed.privateKeyPem !== "string" || typeof parsed.publicKeyPem !== "string") {
    throw new Error(`commons signing key file is malformed: ${keyFilePath}`);
  }
  return validateKeyPair({ privateKeyPem: parsed.privateKeyPem, publicKeyPem: parsed.publicKeyPem });
}

export function resolveCommonsSigningKeyPair(
  env: NodeJS.ProcessEnv = process.env,
  keyFilePath?: string,
): CommonsSigningKeyPair {
  const hasPrivateKey = Boolean(env.COMMONS_SIGNING_PRIVATE_KEY_PEM);
  const hasPublicKey = Boolean(env.COMMONS_SIGNING_PUBLIC_KEY_PEM);
  if (hasPrivateKey !== hasPublicKey) {
    throw new Error("COMMONS_SIGNING_PRIVATE_KEY_PEM and COMMONS_SIGNING_PUBLIC_KEY_PEM must be set together");
  }
  if (env.COMMONS_SIGNING_PRIVATE_KEY_PEM && env.COMMONS_SIGNING_PUBLIC_KEY_PEM) {
    return validateKeyPair({
      privateKeyPem: env.COMMONS_SIGNING_PRIVATE_KEY_PEM,
      publicKeyPem: env.COMMONS_SIGNING_PUBLIC_KEY_PEM,
    });
  }
  if (keyFilePath) {
    try {
      return readPersistedKeyPair(keyFilePath);
    } catch (error) {
      if (!((error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
    }
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const generated = validateKeyPair({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  });
  if (keyFilePath) {
    mkdirSync(dirname(keyFilePath), { recursive: true });
    try {
      writeFileSync(keyFilePath, `${JSON.stringify(generated, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return readPersistedKeyPair(keyFilePath);
      }
      throw error;
    }
  } else if (env.NODE_ENV !== "test") {
    console.warn("commons: generated ephemeral signing key; clients must fetch /v1/signing-key");
  }
  return generated;
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

export function signCommonsEntry(
  entry: Omit<CommonsPackageEntry, "signature">,
  keyPair: CommonsSigningKeyPair,
): ManifestSignature {
  const data = canonicalizeCommonsSignedPayload(commonsPackageContent(entry), entry.integrity, entry.publishedAt);
  return {
    signature: crypto.sign(null, Buffer.from(data, "utf8"), crypto.createPrivateKey(keyPair.privateKeyPem)).toString("base64"),
    publicKey: keyPair.publicKeyPem,
    algorithm: "ed25519",
    signedAt: new Date().toISOString(),
  };
}

export const ed25519ManifestVerifier: SignatureVerifier = (data, sigB64, publicKeyPem) => {
  try {
    const publicKey = crypto.createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") return false;
    return crypto.verify(null, Buffer.from(data, "utf8"), publicKey, Buffer.from(sigB64, "base64"));
  } catch {
    return false;
  }
};
