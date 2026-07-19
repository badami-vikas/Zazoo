import {
  constants,
  type FileHandle,
  chmod,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { dirname, join, resolve } from "node:path";
import {
  metadataForCredential,
  type CredentialField,
  type CredentialMetadata,
  type SourceCredential,
  type SourceCredentialScope,
  type SourceCredentialVault,
} from "./credentials.js";

const REFERENCE_SCHEME = "bridge-vault:";
const REFERENCE_HOST = "dealpilot";
const FILE_SUFFIX = ".credential";

interface CredentialAccount extends SourceCredentialScope {
  version: 1;
  entryId: string;
}

interface StoredCredential {
  version: 1;
  account: CredentialAccount;
  credential: SourceCredential;
}

interface EncryptedEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  keyId: string;
  account: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface CredentialVaultKey {
  id: string;
  key: Uint8Array;
}

export class EncryptedFileCredentialError extends Error {
  constructor(
    readonly code:
      | "invalid_key"
      | "invalid_reference"
      | "invalid_entry"
      | "scope_mismatch"
      | "decryption_failed"
      | "missing_rotation_key"
      | "unsafe_file",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EncryptedFileCredentialError";
  }
}

function randomEntryId(): string {
  return randomBytes(32).toString("hex");
}

function accountValue(scope: SourceCredentialScope): CredentialAccount {
  return { version: 1, ...scope, entryId: randomEntryId() };
}

function encodeAccount(account: CredentialAccount): string {
  return Buffer.from(JSON.stringify(account), "utf8").toString("base64url");
}

function parseAccount(value: string): CredentialAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new EncryptedFileCredentialError(
      "invalid_reference",
      "The encrypted credential reference account is invalid",
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("workspaceId" in parsed) ||
    typeof parsed.workspaceId !== "string" ||
    !("sourceId" in parsed) ||
    typeof parsed.sourceId !== "string" ||
    !("entryId" in parsed) ||
    typeof parsed.entryId !== "string" ||
    !/^[0-9a-f]{64}$/.test(parsed.entryId)
  ) {
    throw new EncryptedFileCredentialError(
      "invalid_reference",
      "The encrypted credential reference account is invalid",
    );
  }
  return parsed as CredentialAccount;
}

function validateKey(key: CredentialVaultKey, label: string): Buffer {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(key.id)) {
    throw new EncryptedFileCredentialError(
      "invalid_key",
      `${label} credential key id is invalid`,
    );
  }
  const bytes = Buffer.from(key.key);
  if (bytes.byteLength !== 32) {
    throw new EncryptedFileCredentialError(
      "invalid_key",
      `${label} credential key must contain exactly 32 bytes`,
    );
  }
  return bytes;
}

function parseCredential(raw: unknown): SourceCredential {
  if (
    typeof raw !== "object" ||
    raw === null ||
    ("userId" in raw && raw.userId !== undefined && typeof raw.userId !== "string") ||
    ("password" in raw &&
      raw.password !== undefined &&
      typeof raw.password !== "string")
  ) {
    throw new EncryptedFileCredentialError(
      "invalid_entry",
      "The encrypted credential entry contains invalid fields",
    );
  }
  const record = raw as SourceCredential;
  return {
    ...(record.userId ? { userId: record.userId } : {}),
    ...(record.password ? { password: record.password } : {}),
  };
}

function parseEnvelope(raw: string): EncryptedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EncryptedFileCredentialError(
      "invalid_entry",
      "The encrypted credential file is not valid JSON",
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("algorithm" in parsed) ||
    parsed.algorithm !== "aes-256-gcm" ||
    !("keyId" in parsed) ||
    typeof parsed.keyId !== "string" ||
    !("account" in parsed) ||
    typeof parsed.account !== "string" ||
    !("iv" in parsed) ||
    typeof parsed.iv !== "string" ||
    !("authTag" in parsed) ||
    typeof parsed.authTag !== "string" ||
    !("ciphertext" in parsed) ||
    typeof parsed.ciphertext !== "string"
  ) {
    throw new EncryptedFileCredentialError(
      "invalid_entry",
      "The encrypted credential file has an unsupported format",
    );
  }
  return parsed as EncryptedEnvelope;
}

function aad(account: string): Buffer {
  return Buffer.from(`bridge-dealpilot-credential:v1:${account}`, "utf8");
}

function encryptedFileName(account: string): string {
  return `${createHash("sha256").update(account).digest("hex")}${FILE_SUFFIX}`;
}

async function closeAfter<T>(
  handle: FileHandle,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } finally {
    await handle.close();
  }
}

export class EncryptedFileSourceCredentialVault
  implements SourceCredentialVault
{
  readonly #directory: string;
  readonly #current: { id: string; key: Buffer };
  readonly #previous: { id: string; key: Buffer } | undefined;

  constructor(options: {
    directory: string;
    current: CredentialVaultKey;
    previous?: CredentialVaultKey;
  }) {
    this.#directory = resolve(options.directory);
    this.#current = {
      id: options.current.id,
      key: validateKey(options.current, "Current"),
    };
    this.#previous = options.previous
      ? {
          id: options.previous.id,
          key: validateKey(options.previous, "Previous"),
        }
      : undefined;
    if (this.#previous?.id === this.#current.id) {
      throw new EncryptedFileCredentialError(
        "invalid_key",
        "Current and previous credential key ids must differ",
      );
    }
  }

  reserve(scope: SourceCredentialScope): string {
    const account = encodeAccount(accountValue(scope));
    return `${REFERENCE_SCHEME}//${REFERENCE_HOST}/${account}`;
  }

  async write(
    scope: SourceCredentialScope,
    reference: string,
    credential: SourceCredential,
  ): Promise<void> {
    const { account, encoded } = this.#account(scope, reference);
    await this.#writeAccount(account, encoded, parseCredential(credential));
  }

  async put(
    scope: SourceCredentialScope,
    credential: SourceCredential,
  ): Promise<string> {
    const reference = this.reserve(scope);
    await this.write(scope, reference, credential);
    return reference;
  }

  async metadata(
    scope: SourceCredentialScope,
    reference: string,
  ): Promise<CredentialMetadata | null> {
    const credential = await this.#read(scope, reference);
    return credential ? metadataForCredential(credential) : null;
  }

  async read(
    scope: SourceCredentialScope,
    reference: string,
    field: CredentialField,
  ): Promise<string | null> {
    const credential = await this.#read(scope, reference);
    return credential?.[field] ?? null;
  }

  async delete(
    scope: SourceCredentialScope,
    reference: string,
  ): Promise<void> {
    const { encoded } = this.#account(scope, reference);
    try {
      await unlink(this.#path(encoded));
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }

  /** Re-encrypt every entry that still names the configured previous key. */
  async rotateAll(): Promise<number> {
    await this.#ensureDirectory();
    const names = await readdir(this.#directory);
    let rotated = 0;
    for (const name of names) {
      if (!name.endsWith(FILE_SUFFIX)) continue;
      const envelope = await this.#readEnvelope(join(this.#directory, name));
      if (name !== encryptedFileName(envelope.account)) {
        throw new EncryptedFileCredentialError(
          "unsafe_file",
          "Encrypted credential filename does not match its account",
        );
      }
      if (envelope.keyId === this.#current.id) continue;
      const stored = this.#decrypt(envelope);
      await this.#writeAccount(
        stored.account,
        envelope.account,
        stored.credential,
      );
      rotated += 1;
    }
    return rotated;
  }

  async #read(
    scope: SourceCredentialScope,
    reference: string,
  ): Promise<SourceCredential | null> {
    const { account, encoded } = this.#account(scope, reference);
    let envelope: EncryptedEnvelope;
    try {
      envelope = await this.#readEnvelope(this.#path(encoded));
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
    if (envelope.account !== encoded) {
      throw new EncryptedFileCredentialError(
        "scope_mismatch",
        "The encrypted credential file does not match its reference",
      );
    }
    const stored = this.#decrypt(envelope);
    if (
      stored.account.workspaceId !== account.workspaceId ||
      stored.account.sourceId !== account.sourceId ||
      stored.account.entryId !== account.entryId
    ) {
      throw new EncryptedFileCredentialError(
        "scope_mismatch",
        "The encrypted credential payload is outside the requested Organization or Source",
      );
    }
    if (envelope.keyId !== this.#current.id) {
      await this.#writeAccount(account, encoded, stored.credential);
    }
    return stored.credential;
  }

  #decrypt(envelope: EncryptedEnvelope): StoredCredential {
    const selected =
      envelope.keyId === this.#current.id
        ? this.#current
        : envelope.keyId === this.#previous?.id
          ? this.#previous
          : undefined;
    if (!selected) {
      throw new EncryptedFileCredentialError(
        "missing_rotation_key",
        `No credential key is configured for key id "${envelope.keyId}"`,
      );
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        selected.key,
        Buffer.from(envelope.iv, "base64url"),
      );
      decipher.setAAD(aad(envelope.account));
      decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]);
      const parsed = JSON.parse(plaintext.toString("utf8")) as Partial<StoredCredential>;
      if (
        parsed.version !== 1 ||
        !parsed.account ||
        encodeAccount(parsed.account) !== envelope.account
      ) {
        throw new Error("credential payload metadata is invalid");
      }
      return {
        version: 1,
        account: parsed.account,
        credential: parseCredential(parsed.credential),
      };
    } catch (error) {
      if (error instanceof EncryptedFileCredentialError) throw error;
      throw new EncryptedFileCredentialError(
        "decryption_failed",
        "The credential file could not be authenticated or decrypted",
        { cause: error },
      );
    }
  }

  async #writeAccount(
    account: CredentialAccount,
    encoded: string,
    credential: SourceCredential,
  ): Promise<void> {
    await this.#ensureDirectory();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#current.key, iv);
    cipher.setAAD(aad(encoded));
    const plaintext = Buffer.from(
      JSON.stringify({ version: 1, account, credential } satisfies StoredCredential),
      "utf8",
    );
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: EncryptedEnvelope = {
      version: 1,
      algorithm: "aes-256-gcm",
      keyId: this.#current.id,
      account: encoded,
      iv: iv.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
    const target = this.#path(encoded);
    const temporary = `${target}.${randomEntryId()}.tmp`;
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(envelope)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      await rename(temporary, target);
      await chmod(target, 0o600);
      const directory = await open(dirname(target), constants.O_RDONLY);
      await closeAfter(directory, () => directory.sync());
    } catch (error) {
      try {
        await handle.close();
      } catch {
        // Preserve the original write failure.
      }
      try {
        await unlink(temporary);
      } catch {
        // The temporary may already have been atomically renamed.
      }
      throw error;
    }
  }

  async #readEnvelope(path: string): Promise<EncryptedEnvelope> {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    const handle = await open(path, constants.O_RDONLY | noFollow);
    return closeAfter(handle, async () => {
      const stats = await handle.stat();
      if (!stats.isFile() || (stats.mode & 0o077) !== 0) {
        throw new EncryptedFileCredentialError(
          "unsafe_file",
          "Credential files must be regular owner-only files",
        );
      }
      return parseEnvelope(await handle.readFile("utf8"));
    });
  }

  async #ensureDirectory(): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await chmod(this.#directory, 0o700);
  }

  #path(encoded: string): string {
    return join(this.#directory, encryptedFileName(encoded));
  }

  #account(
    scope: SourceCredentialScope,
    reference: string,
  ): { account: CredentialAccount; encoded: string } {
    let parsed: URL;
    try {
      parsed = new URL(reference);
    } catch {
      throw new EncryptedFileCredentialError(
        "invalid_reference",
        "The encrypted credential reference is invalid",
      );
    }
    const encoded = parsed.pathname.slice(1);
    if (
      parsed.protocol !== REFERENCE_SCHEME ||
      parsed.hostname !== REFERENCE_HOST ||
      !encoded ||
      encoded.length > 4_096 ||
      parsed.search ||
      parsed.hash
    ) {
      throw new EncryptedFileCredentialError(
        "invalid_reference",
        "The credential reference is not owned by this encrypted file vault",
      );
    }
    const account = parseAccount(encoded);
    if (
      account.workspaceId !== scope.workspaceId ||
      account.sourceId !== scope.sourceId
    ) {
      throw new EncryptedFileCredentialError(
        "scope_mismatch",
        "The credential reference is outside the requested Organization or Source",
      );
    }
    return { account, encoded };
  }
}

export function credentialVaultKeyFromBase64(
  id: string,
  encoded: string,
): CredentialVaultKey {
  let key: Buffer;
  try {
    key = Buffer.from(encoded, "base64");
  } catch (error) {
    throw new EncryptedFileCredentialError(
      "invalid_key",
      "Credential vault key is not valid base64",
      { cause: error },
    );
  }
  if (
    key.byteLength !== 32 ||
    key.toString("base64").replace(/=+$/, "") !== encoded.trim().replace(/=+$/, "")
  ) {
    throw new EncryptedFileCredentialError(
      "invalid_key",
      "Credential vault key must be canonical base64 for exactly 32 bytes",
    );
  }
  return { id, key };
}
