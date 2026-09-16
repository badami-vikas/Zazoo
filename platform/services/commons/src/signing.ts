/**
 * Commons crypto binding at the service seam. @bridge/core stays pure and
 * zero-runtime-deps, so the node:crypto ed25519 implementation lives here while
 * both publisher and installer share core's canonical manifest bytes.
 */
import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  canonicalizeCommonsArchetypeSignedPayload,
  canonicalizeCommonsSignedPayload,
  canonicalizeManifest,
  commonsArchetypeContent,
  commonsModuleContent,
  type CommonsArchetypeEntry,
  type CommonsModuleEntry,
  type ManifestSignature,
  type ModuleManifest,
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

export function signManifest(manifest: ModuleManifest, keyPair: CommonsSigningKeyPair): ManifestSignature {
  const data = canonicalizeManifest(manifest);
  return {
    signature: crypto.sign(null, Buffer.from(data, "utf8"), crypto.createPrivateKey(keyPair.privateKeyPem)).toString("base64"),
    publicKey: keyPair.publicKeyPem,
    algorithm: "ed25519",
    signedAt: new Date().toISOString(),
  };
}

export function signCommonsEntry(
  entry: Omit<CommonsModuleEntry, "signature">,
  keyPair: CommonsSigningKeyPair,
): ManifestSignature {
  const data = canonicalizeCommonsSignedPayload(commonsModuleContent(entry), entry.integrity, entry.publishedAt);
  return {
    signature: crypto.sign(null, Buffer.from(data, "utf8"), crypto.createPrivateKey(keyPair.privateKeyPem)).toString("base64"),
    publicKey: keyPair.publicKeyPem,
    algorithm: "ed25519",
    signedAt: new Date().toISOString(),
  };
}

export function signCommonsArchetypeEntry(
  entry: Omit<CommonsArchetypeEntry, "signature">,
  keyPair: CommonsSigningKeyPair,
): ManifestSignature {
  const data = canonicalizeCommonsArchetypeSignedPayload(
    commonsArchetypeContent(entry),
    entry.integrity,
    entry.publishedAt,
  );
  return {
    signature: crypto.sign(null, Buffer.from(data, "utf8"), crypto.createPrivateKey(keyPair.privateKeyPem)).toString("base64"),
    publicKey: keyPair.publicKeyPem,
    algorithm: "ed25519",
    signedAt: new Date().toISOString(),
  };
}

/**
 * The publish token, resolved the way the signing key above is.
 *
 * Publication is the one privileged operation this service has, so the token
 * stays a real secret — 48 random hex characters, written 0600, never a
 * default anyone could guess. What changes is the FAILURE MODE: an absent
 * token used to throw at boot, which made a local-first Commons unrunnable out
 * of the box, and a registry that never runs is why a Module sitting in
 * Commons could not be installed from the app at all. Generating and
 * persisting one on first boot is exactly what the signing key already does,
 * for the same reason.
 *
 * `COMMONS_PUBLISH_TOKEN` still wins when set. A deployment managing its own
 * secret is unaffected, and a SHARED registry must set it — a generated token
 * lives only on the machine that generated it, which is the whole point.
 */
export function resolveCommonsPublishToken(
  env: NodeJS.ProcessEnv = process.env,
  tokenFilePath?: string,
): string {
  const supplied = env.COMMONS_PUBLISH_TOKEN?.trim();
  if (supplied) return supplied;
  if (tokenFilePath) {
    try {
      const parsed = JSON.parse(readFileSync(tokenFilePath, "utf8")) as { publishToken?: unknown };
      if (typeof parsed.publishToken !== "string" || parsed.publishToken.length < 32) {
        throw new Error(`commons publish token file is malformed: ${tokenFilePath}`);
      }
      return parsed.publishToken;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const generated = crypto.randomBytes(24).toString("hex");
  if (tokenFilePath) {
    mkdirSync(dirname(tokenFilePath), { recursive: true });
    try {
      writeFileSync(tokenFilePath, `${JSON.stringify({ publishToken: generated }, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      // Another process won the race; the token on disk is the real one.
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return resolveCommonsPublishToken(env, tokenFilePath);
      }
      throw error;
    }
  }
  return generated;
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
