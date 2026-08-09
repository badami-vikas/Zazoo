/**
 * AES-256-GCM encryption for `oauth_tokens` at rest (BUGS.md OPEN 2026-07-08:
 * "OAuth access + refresh tokens stored PLAINTEXT in local pglite"; pulled
 * forward per ADR-215/AP-135 as the vault half of TASK-006's Option B).
 *
 * Each field is encrypted independently with AAD bound to
 * `<integrationId>:<field>`, so a ciphertext can never be replayed into a
 * different Integration's row or the other field. A fresh random IV is drawn
 * per encryption; equality between two token records (for compare-and-swap)
 * is therefore checked in application code against the DECRYPTED record, not
 * via SQL column equality on ciphertext — see PgliteSecretStore.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface TokenVaultKey {
  id: string;
  key: Uint8Array;
}

export interface TokenVaultKeys {
  current: TokenVaultKey;
  previous?: TokenVaultKey;
}

export interface EncryptedTokenField {
  version: 1;
  algorithm: "aes-256-gcm";
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

function aad(context: string): Buffer {
  return Buffer.from(`bridge-oauth-token:v1:${context}`, "utf8");
}

function validateKey(key: TokenVaultKey, label: string): Buffer {
  const bytes = Buffer.from(key.key);
  if (bytes.byteLength !== 32) {
    throw new Error(`${label} OAuth token vault key must contain exactly 32 bytes`);
  }
  return bytes;
}

/** Encrypt one field value. `context` must be unique per row+field (e.g. `${integrationId}:access_token`). */
export function encryptTokenField(
  keys: TokenVaultKeys,
  context: string,
  plaintext: string,
): EncryptedTokenField {
  const keyBytes = validateKey(keys.current, "Current");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes, iv);
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    keyId: keys.current.id,
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

/** Decrypt one field value, honoring a configured previous key for rotation. */
export function decryptTokenField(
  keys: TokenVaultKeys,
  context: string,
  field: EncryptedTokenField,
): string {
  const selected =
    field.keyId === keys.current.id
      ? keys.current
      : field.keyId === keys.previous?.id
        ? keys.previous
        : undefined;
  if (!selected) {
    throw new Error(
      `No OAuth token vault key is configured for key id "${field.keyId}"`,
    );
  }
  const keyBytes = validateKey(selected, selected === keys.current ? "Current" : "Previous");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes,
    Buffer.from(field.iv, "base64url"),
  );
  decipher.setAAD(aad(context));
  decipher.setAuthTag(Buffer.from(field.authTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(field.ciphertext, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function encodeTokenField(field: EncryptedTokenField): string {
  return JSON.stringify(field);
}

export function decodeTokenField(raw: string): EncryptedTokenField {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Encrypted OAuth token field is not valid JSON");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Partial<EncryptedTokenField>).version !== 1 ||
    (parsed as Partial<EncryptedTokenField>).algorithm !== "aes-256-gcm" ||
    typeof (parsed as Partial<EncryptedTokenField>).keyId !== "string" ||
    typeof (parsed as Partial<EncryptedTokenField>).iv !== "string" ||
    typeof (parsed as Partial<EncryptedTokenField>).authTag !== "string" ||
    typeof (parsed as Partial<EncryptedTokenField>).ciphertext !== "string"
  ) {
    throw new Error("Encrypted OAuth token field has an unsupported shape");
  }
  return parsed as EncryptedTokenField;
}

/**
 * An ephemeral, process-local key used only when no vault key is configured
 * (in-memory Local Planes, and tests). Never durable: a persisted Local Plane
 * MUST be given an explicit key by its caller or every token becomes
 * unrecoverable across restarts — that failure mode is deliberately loud
 * (wiring.ts requires the real env-configured key whenever both a durable
 * `BRIDGE_LOCAL_DIR` and real Google OAuth are configured).
 */
export function ephemeralTokenVaultKeys(): TokenVaultKeys {
  return { current: { id: "ephemeral", key: randomBytes(32) } };
}
