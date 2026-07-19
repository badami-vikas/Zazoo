import {
  metadataForCredential,
  type CredentialField,
  type CredentialMetadata,
  type SourceCredential,
  type SourceCredentialScope,
  type SourceCredentialVault,
} from "./credentials.js";

const DEFAULT_SERVICE = "com.bridge.dealpilot";
const REFERENCE_SCHEME = "keyring:";

interface KeyringEntry {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | undefined>;
  deleteCredential(): Promise<boolean>;
}

export type KeyringEntryFactory = (service: string, account: string) => KeyringEntry;

let keyringModule: Promise<typeof import("@napi-rs/keyring")> | undefined;

function lazyNativeEntry(service: string, account: string): KeyringEntry {
  const entry = async () => {
    keyringModule ??= import("@napi-rs/keyring");
    const { AsyncEntry } = await keyringModule;
    return new AsyncEntry(service, account);
  };
  return {
    setPassword: async (password) => (await entry()).setPassword(password),
    getPassword: async () => (await entry()).getPassword(),
    deleteCredential: async () => (await entry()).deleteCredential(),
  };
}

interface StoredCredential {
  version: 1;
  userId?: string;
  password?: string;
}

interface CredentialAccount extends SourceCredentialScope {
  version: 1;
  entryId: string;
}

export class KeyringCredentialError extends Error {
  constructor(
    readonly code: "invalid_reference" | "invalid_entry" | "scope_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "KeyringCredentialError";
  }
}

function createAccount(scope: SourceCredentialScope): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const entryId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return Buffer.from(
    JSON.stringify({ version: 1, ...scope, entryId } satisfies CredentialAccount),
    "utf8",
  ).toString("base64url");
}

function parseAccount(account: string): CredentialAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(account, "base64url").toString("utf8"));
  } catch {
    throw new KeyringCredentialError("invalid_reference", "The credential reference account is invalid");
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
    throw new KeyringCredentialError("invalid_reference", "The credential reference account is invalid");
  }
  return parsed as CredentialAccount;
}

function parseCredential(value: string): SourceCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new KeyringCredentialError("invalid_entry", "The OS credential entry is not valid Bridge credential data");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1
  ) {
    throw new KeyringCredentialError("invalid_entry", "The OS credential entry has an unsupported format");
  }
  const record = parsed as Partial<StoredCredential>;
  if (
    (record.userId !== undefined && typeof record.userId !== "string") ||
    (record.password !== undefined && typeof record.password !== "string")
  ) {
    throw new KeyringCredentialError("invalid_entry", "The OS credential entry contains invalid fields");
  }
  return {
    ...(record.userId ? { userId: record.userId } : {}),
    ...(record.password ? { password: record.password } : {}),
  };
}

function isMissingEntryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  return (
    error.name === "NoEntry" ||
    code === "NoEntry" ||
    /^NoEntry\b/.test(error.message) ||
    /no matching entry found in secure storage/i.test(error.message)
  );
}

export class KeyringSourceCredentialVault implements SourceCredentialVault {
  readonly #service: string;
  readonly #entry: KeyringEntryFactory;

  constructor(options: {
    service?: string;
    entryFactory?: KeyringEntryFactory;
  } = {}) {
    this.#service = options.service ?? DEFAULT_SERVICE;
    this.#entry = options.entryFactory ?? lazyNativeEntry;
  }

  reserve(scope: SourceCredentialScope): string {
    const account = createAccount(scope);
    return `${REFERENCE_SCHEME}//${this.#service}/${account}`;
  }

  async write(
    scope: SourceCredentialScope,
    reference: string,
    credential: SourceCredential,
  ): Promise<void> {
    const account = this.#account(scope, reference);
    const entry = this.#entry(this.#service, account);
    const stored: StoredCredential = {
      version: 1,
      ...(credential.userId ? { userId: credential.userId } : {}),
      ...(credential.password ? { password: credential.password } : {}),
    };
    await entry.setPassword(JSON.stringify(stored));
  }

  async put(scope: SourceCredentialScope, credential: SourceCredential): Promise<string> {
    const reference = this.reserve(scope);
    await this.write(scope, reference, credential);
    return reference;
  }

  async metadata(
    scope: SourceCredentialScope,
    reference: string,
  ): Promise<CredentialMetadata | null> {
    const value = await this.#readEntry(scope, reference);
    return value == null ? null : metadataForCredential(parseCredential(value));
  }

  async read(
    scope: SourceCredentialScope,
    reference: string,
    field: CredentialField,
  ): Promise<string | null> {
    const value = await this.#readEntry(scope, reference);
    return value == null ? null : parseCredential(value)[field] ?? null;
  }

  async delete(scope: SourceCredentialScope, reference: string): Promise<void> {
    const account = this.#account(scope, reference);
    try {
      await this.#entry(this.#service, account).deleteCredential();
    } catch (error) {
      if (!isMissingEntryError(error)) throw error;
    }
  }

  async #readEntry(
    scope: SourceCredentialScope,
    reference: string,
  ): Promise<string | null> {
    const account = this.#account(scope, reference);
    try {
      return (await this.#entry(this.#service, account).getPassword()) ?? null;
    } catch (error) {
      if (isMissingEntryError(error)) return null;
      throw error;
    }
  }

  #account(scope: SourceCredentialScope, reference: string): string {
    let parsed: URL;
    try {
      parsed = new URL(reference);
    } catch {
      throw new KeyringCredentialError("invalid_reference", "The credential reference is invalid");
    }
    const account = parsed.pathname.slice(1);
    if (
      parsed.protocol !== REFERENCE_SCHEME ||
      parsed.hostname !== this.#service ||
      !account ||
      account.length > 4_096 ||
      parsed.search ||
      parsed.hash
    ) {
      throw new KeyringCredentialError("invalid_reference", "The credential reference is not owned by this OS vault");
    }
    const accountScope = parseAccount(account);
    if (
      accountScope.workspaceId !== scope.workspaceId ||
      accountScope.sourceId !== scope.sourceId
    ) {
      throw new KeyringCredentialError(
        "scope_mismatch",
        "The credential reference is outside the requested Organization or Source",
      );
    }
    return account;
  }
}
