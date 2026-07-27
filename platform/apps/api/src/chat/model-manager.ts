import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import {
  chmod,
  link,
  mkdir,
  readFile,
  rename,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  guardedDownloadToFile,
  type GuardedDownloadResult,
} from "@bridge/net-guard";
import {
  LlamaCppProvider,
  MANAGED_LLAMA_MODEL_ID,
} from "@bridge/models";

export type ManagedModelState =
  | "not_installed"
  | "downloading"
  | "verifying"
  | "loading"
  | "ready"
  | "degraded"
  | "failed";

interface RuntimeManifest {
  version: 1;
  runtime: {
    release: string;
    revision: string;
    license: string;
  };
  model: {
    providerModelId: string;
    repository: string;
    repositoryRevision: string;
    fileCommit: string;
    file: string;
    bytes: number;
    sha256: string;
    license: string;
    quantizedWith: string;
    url: string;
    allowedRedirectOrigins: string[];
  };
}

export interface ManagedModelStatus {
  state: ManagedModelState;
  model: string;
  expectedBytes: number;
  downloadedBytes: number;
  errorCode?: string;
}

export interface ManagedModelServiceOptions {
  runtimeDir?: string;
  manifestPath?: string;
  provider?: Pick<LlamaCppProvider, "probe">;
  downloadToFile?: typeof guardedDownloadToFile;
}

interface ActiveInstall {
  controller: AbortController;
  status: ManagedModelStatus;
  completion: Promise<void>;
  lockToken: string;
}

interface InstalledFileIdentity {
  size: number;
  modifiedMs: number;
  changedMs: number;
}

const INSTALL_LOCK_MAX_AGE_MS = 8 * 60 * 60 * 1_000;

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function parseManifest(value: unknown): RuntimeManifest {
  const root = asObject(value, "model runtime manifest");
  const runtime = asObject(root["runtime"], "model runtime manifest.runtime");
  const model = asObject(root["model"], "model runtime manifest.model");
  if (
    root["version"] !== 1 ||
    model["providerModelId"] !== MANAGED_LLAMA_MODEL_ID ||
    typeof model["file"] !== "string" ||
    !model["file"].endsWith(".gguf") ||
    !Number.isSafeInteger(model["bytes"]) ||
    (model["bytes"] as number) <= 0 ||
    typeof model["sha256"] !== "string" ||
    !/^[0-9a-f]{64}$/.test(model["sha256"] as string) ||
    typeof model["url"] !== "string" ||
    !Array.isArray(model["allowedRedirectOrigins"]) ||
    !(model["allowedRedirectOrigins"] as unknown[]).every(
      (origin) => typeof origin === "string" && new URL(origin).origin === origin,
    )
  ) {
    throw new Error("model runtime manifest is invalid");
  }
  for (const field of [
    "repository",
    "repositoryRevision",
    "fileCommit",
    "license",
    "quantizedWith",
  ]) {
    if (typeof model[field] !== "string" || !(model[field] as string).trim()) {
      throw new Error(`model runtime manifest.model.${field} is invalid`);
    }
  }
  for (const field of ["release", "revision", "license"]) {
    if (
      typeof runtime[field] !== "string" ||
      !(runtime[field] as string).trim()
    ) {
      throw new Error(`model runtime manifest.runtime.${field} is invalid`);
    }
  }
  return value as RuntimeManifest;
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}

function assertInstallNotCancelled(active: ActiveInstall): void {
  if (!active.controller.signal.aborted) return;
  throw (
    active.controller.signal.reason ??
    new DOMException("model installation cancelled", "AbortError")
  );
}

async function readJsonIfPresent(path: string): Promise<Record<string, unknown> | null> {
  try {
    return asObject(JSON.parse(await readFile(path, "utf8")) as unknown, path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function fileIdentity(
  info: Pick<Stats, "size" | "mtimeMs" | "ctimeMs">,
): InstalledFileIdentity {
  return {
    size: info.size,
    modifiedMs: info.mtimeMs,
    changedMs: info.ctimeMs,
  };
}

function sameFileIdentity(
  value: unknown,
  expected: InstalledFileIdentity,
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const identity = value as Record<string, unknown>;
  return (
    identity["size"] === expected.size &&
    identity["modifiedMs"] === expected.modifiedMs &&
    identity["changedMs"] === expected.changedMs
  );
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "download_cancelled";
  }
  if (
    error instanceof Error &&
    /space|ENOSPC|quota/i.test(error.message)
  ) {
    return "insufficient_disk_space";
  }
  if (error instanceof Error && /SHA-256|integrity/i.test(error.message)) {
    return "integrity_check_failed";
  }
  return "model_install_failed";
}

export class ManagedModelService {
  readonly #runtimeDir: string | undefined;
  readonly #manifestPath: string | undefined;
  readonly #provider: Pick<LlamaCppProvider, "probe"> | undefined;
  readonly #downloadToFile: typeof guardedDownloadToFile;
  #manifest?: RuntimeManifest;
  #active: ActiveInstall | undefined;
  #installRequest: Promise<ManagedModelStatus> | undefined;

  constructor(options: ManagedModelServiceOptions) {
    this.#runtimeDir = options.runtimeDir;
    this.#manifestPath = options.manifestPath;
    this.#provider = options.provider;
    this.#downloadToFile = options.downloadToFile ?? guardedDownloadToFile;
  }

  get enabled(): boolean {
    return Boolean(this.#runtimeDir && this.#manifestPath && this.#provider);
  }

  get runtimeDir(): string | null {
    return this.#runtimeDir ?? null;
  }

  get capabilityFile(): string | null {
    return this.runtimeDir ? join(this.runtimeDir, "endpoint.json") : null;
  }

  async #loadManifest(): Promise<RuntimeManifest> {
    if (this.#manifest) return this.#manifest;
    if (!this.#manifestPath) throw new Error("model runtime manifest is unavailable");
    this.#manifest = parseManifest(
      JSON.parse(await readFile(this.#manifestPath, "utf8")) as unknown,
    );
    return this.#manifest;
  }

  async status(): Promise<ManagedModelStatus> {
    if (!this.enabled) {
      return {
        state: "not_installed",
        model: MANAGED_LLAMA_MODEL_ID,
        expectedBytes: 0,
        downloadedBytes: 0,
        errorCode: "managed_runtime_unavailable",
      };
    }
    if (this.#active) return { ...this.#active.status };
    const manifest = await this.#loadManifest();
    const runtimeDir = this.runtimeDir!;
    const modelPath = join(runtimeDir, "models", manifest.model.file);
    let modelSize = 0;
    try {
      modelSize = (await stat(modelPath)).size;
    } catch {
      const partialPath = `${modelPath}.part`;
      try {
        modelSize = (await stat(partialPath)).size;
      } catch {
        const failure = await readJsonIfPresent(
          join(runtimeDir, "install-failure.json"),
        );
        return {
          state: failure ? "failed" : "not_installed",
          model: manifest.model.providerModelId,
          expectedBytes: manifest.model.bytes,
          downloadedBytes: 0,
          ...(typeof failure?.["errorCode"] === "string"
            ? { errorCode: failure["errorCode"] }
            : {}),
        };
      }
      const failure = await readJsonIfPresent(
        join(runtimeDir, "install-failure.json"),
      );
      return {
        state: failure ? "failed" : "not_installed",
        model: manifest.model.providerModelId,
        expectedBytes: manifest.model.bytes,
        downloadedBytes: modelSize,
        ...(typeof failure?.["errorCode"] === "string"
          ? { errorCode: failure["errorCode"] }
          : {}),
      };
    }
    if (modelSize !== manifest.model.bytes) {
      return {
        state: "failed",
        model: manifest.model.providerModelId,
        expectedBytes: manifest.model.bytes,
        downloadedBytes: modelSize,
        errorCode: "installed_model_size_mismatch",
      };
    }
    try {
      await this.#verifyInstalledModel(manifest, modelPath);
    } catch {
      return {
        state: "failed",
        model: manifest.model.providerModelId,
        expectedBytes: manifest.model.bytes,
        downloadedBytes: modelSize,
        errorCode: "installed_model_integrity_mismatch",
      };
    }
    const health = await this.#provider!.probe();
    if (health === "healthy") {
      return {
        state: "ready",
        model: manifest.model.providerModelId,
        expectedBytes: manifest.model.bytes,
        downloadedBytes: manifest.model.bytes,
      };
    }
    try {
      await stat(join(runtimeDir, "start.request"));
      const runtimeFailure = await readJsonIfPresent(
        join(runtimeDir, "runtime-failure.json"),
      );
      if (runtimeFailure) {
        return {
          state: "failed",
          model: manifest.model.providerModelId,
          expectedBytes: manifest.model.bytes,
          downloadedBytes: manifest.model.bytes,
          errorCode:
            typeof runtimeFailure["errorCode"] === "string"
              ? runtimeFailure["errorCode"]
              : "runtime_start_failed",
        };
      }
      return {
        state: health === "degraded" ? "degraded" : "loading",
        model: manifest.model.providerModelId,
        expectedBytes: manifest.model.bytes,
        downloadedBytes: manifest.model.bytes,
        ...(health === "degraded" ? { errorCode: "runtime_degraded" } : {}),
      };
    } catch {
      return {
        state: "loading",
        model: manifest.model.providerModelId,
        expectedBytes: manifest.model.bytes,
        downloadedBytes: manifest.model.bytes,
        errorCode: "runtime_start_required",
      };
    }
  }

  async install(): Promise<ManagedModelStatus> {
    if (!this.enabled) {
      throw new Error("managed local model installation is unavailable");
    }
    if (this.#active) return { ...this.#active.status };
    if (this.#installRequest) return this.#installRequest;
    const request = this.#beginInstall();
    this.#installRequest = request;
    try {
      return await request;
    } finally {
      if (this.#installRequest === request) this.#installRequest = undefined;
    }
  }

  async #beginInstall(): Promise<ManagedModelStatus> {
    const manifest = await this.#loadManifest();
    const runtimeDir = this.runtimeDir!;
    const lockToken = await this.#acquireInstallLock();
    const modelDir = join(runtimeDir, "models");
    const modelPath = join(modelDir, manifest.model.file);
    const partialPath = `${modelPath}.part`;
    let lockOwnedByActiveInstall = false;
    try {
      await mkdir(modelDir, { recursive: true });
      let existing = 0;
      let finalInfo: Stats | null = null;
      try {
        finalInfo = await stat(modelPath);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
      if (finalInfo?.size === manifest.model.bytes) {
        try {
          await this.#verifyInstalledModel(manifest, modelPath);
          await unlink(join(runtimeDir, "install-failure.json")).catch(() => {});
          await this.requestStart();
          return this.status();
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/SHA-256|size does not match/.test(error.message)
          ) {
            throw error;
          }
        }
      }
      if (finalInfo) {
        await unlink(modelPath);
        await unlink(join(runtimeDir, "installation.json")).catch(() => {});
      }
      try {
        existing = (await stat(partialPath)).size;
      } catch {
        // A missing partial is the ordinary first-install path.
      }
      const disk = await statfs(modelDir, { bigint: true });
      const available = disk.bavail * disk.bsize;
      const required =
        BigInt(Math.max(0, manifest.model.bytes - existing)) +
        512n * 1024n * 1024n;
      if (available < required) {
        throw new Error("insufficient disk space for verified model installation");
      }
      await unlink(join(runtimeDir, "install-failure.json")).catch(() => {});
      const controller = new AbortController();
      const active: ActiveInstall = {
        controller,
        status: {
          state: "downloading",
          model: manifest.model.providerModelId,
          expectedBytes: manifest.model.bytes,
          downloadedBytes: existing,
        },
        completion: Promise.resolve(),
        lockToken,
      };
      this.#active = active;
      lockOwnedByActiveInstall = true;
      active.completion = this.#runInstall(
        manifest,
        partialPath,
        modelPath,
        active,
      );
      return { ...active.status };
    } finally {
      if (!lockOwnedByActiveInstall) {
        await this.#releaseInstallLock(lockToken);
      }
    }
  }

  async #runInstall(
    manifest: RuntimeManifest,
    partialPath: string,
    modelPath: string,
    active: ActiveInstall,
  ): Promise<void> {
    let result: GuardedDownloadResult | undefined;
    let promoted = false;
    try {
      result = await this.#downloadToFile(manifest.model.url, partialPath, {
        expectedBytes: manifest.model.bytes,
        expectedSha256: manifest.model.sha256,
        maxBytes: manifest.model.bytes,
        timeoutMs: 6 * 60 * 60 * 1_000,
        maxRedirects: 3,
        signal: active.controller.signal,
        allowedRedirectOrigins: manifest.model.allowedRedirectOrigins,
        onProgress: ({ downloadedBytes }) => {
          if (this.#active) {
            this.#active.status = {
              ...this.#active.status,
              downloadedBytes,
            };
          }
        },
      });
      assertInstallNotCancelled(active);
      if (
        result.bytes !== manifest.model.bytes ||
        result.sha256 !== manifest.model.sha256
      ) {
        throw new Error("verified model download returned inconsistent integrity metadata");
      }
      if (this.#active) {
        this.#active.status = {
          ...this.#active.status,
          state: "verifying",
          downloadedBytes: manifest.model.bytes,
        };
      }
      assertInstallNotCancelled(active);
      await rename(partialPath, modelPath);
      promoted = true;
      await chmod(modelPath, 0o600);
      const installedFile = fileIdentity(await stat(modelPath));
      assertInstallNotCancelled(active);
      await atomicJson(join(this.runtimeDir!, "installation.json"), {
        version: 1,
        model: manifest.model.providerModelId,
        repository: manifest.model.repository,
        repositoryRevision: manifest.model.repositoryRevision,
        fileCommit: manifest.model.fileCommit,
        file: manifest.model.file,
        bytes: manifest.model.bytes,
        sha256: manifest.model.sha256,
        license: manifest.model.license,
        quantizedWith: manifest.model.quantizedWith,
        finalUrl: result.finalUrl,
        installedAt: new Date().toISOString(),
        installedFile,
      });
      assertInstallNotCancelled(active);
      await unlink(join(this.runtimeDir!, "install-failure.json")).catch(() => {});
      await this.requestStart(active.controller.signal);
      assertInstallNotCancelled(active);
    } catch (error) {
      const cancelled = active.controller.signal.aborted;
      const errorCode = cancelled
        ? "download_cancelled"
        : safeErrorCode(error);
      if (cancelled) {
        await Promise.all([
          unlink(join(this.runtimeDir!, "installation.json")).catch(() => {}),
          unlink(join(this.runtimeDir!, "start.request")).catch(() => {}),
          promoted
            ? rename(modelPath, partialPath).catch(async () => {
                await unlink(modelPath).catch(() => {});
              })
            : Promise.resolve(),
        ]);
      }
      console.error("[bridge-model] managed model installation failed", {
        errorCode,
      });
      await atomicJson(join(this.runtimeDir!, "install-failure.json"), {
        version: 1,
        errorCode,
        failedAt: new Date().toISOString(),
      }).catch(() => {});
      if (this.#active === active) {
        active.status = {
          ...active.status,
          state: "failed",
          errorCode,
        };
      }
    } finally {
      await this.#releaseInstallLock(active.lockToken);
      if (this.#active === active) this.#active = undefined;
    }
  }

  async cancelInstall(): Promise<ManagedModelStatus> {
    const active = this.#active;
    active?.controller.abort(
      new DOMException("model installation cancelled", "AbortError"),
    );
    await active?.completion;
    return this.status();
  }

  async requestStart(signal?: AbortSignal): Promise<void> {
    if (!this.runtimeDir) {
      throw new Error("managed local model runtime is unavailable");
    }
    signal?.throwIfAborted();
    const manifest = await this.#loadManifest();
    const modelPath = join(this.runtimeDir, "models", manifest.model.file);
    await this.#verifyInstalledModel(manifest, modelPath);
    signal?.throwIfAborted();
    await unlink(join(this.runtimeDir, "runtime-failure.json")).catch(() => {});
    signal?.throwIfAborted();
    await atomicJson(join(this.runtimeDir, "start.request"), {
      version: 1,
      requestedAt: new Date().toISOString(),
    });
    if (signal?.aborted) {
      await unlink(join(this.runtimeDir, "start.request")).catch(() => {});
      signal.throwIfAborted();
    }
  }

  async requestStop(): Promise<void> {
    if (!this.runtimeDir) return;
    await unlink(join(this.runtimeDir, "start.request")).catch(() => {});
  }

  close(): void {
    this.#active?.controller.abort(
      new DOMException("Bridge API is shutting down", "AbortError"),
    );
  }

  async #verifyInstalledModel(
    manifest: RuntimeManifest,
    modelPath: string,
  ): Promise<void> {
    const info = await stat(modelPath);
    if (info.size !== manifest.model.bytes) {
      throw new Error("installed model size does not match the pinned manifest");
    }
    const identity = fileIdentity(info);
    let receipt: Record<string, unknown> | null = null;
    try {
      receipt = await readJsonIfPresent(
        join(this.runtimeDir!, "installation.json"),
      );
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (
      receipt?.["model"] === manifest.model.providerModelId &&
      receipt["file"] === manifest.model.file &&
      receipt["bytes"] === manifest.model.bytes &&
      receipt["sha256"] === manifest.model.sha256 &&
      sameFileIdentity(receipt["installedFile"], identity)
    ) {
      return;
    }
    if ((await sha256File(modelPath)) !== manifest.model.sha256) {
      throw new Error("installed model SHA-256 does not match the pinned manifest");
    }
    await atomicJson(join(this.runtimeDir!, "installation.json"), {
      version: 1,
      model: manifest.model.providerModelId,
      repository: manifest.model.repository,
      repositoryRevision: manifest.model.repositoryRevision,
      fileCommit: manifest.model.fileCommit,
      file: manifest.model.file,
      bytes: manifest.model.bytes,
      sha256: manifest.model.sha256,
      license: manifest.model.license,
      quantizedWith: manifest.model.quantizedWith,
      finalUrl: manifest.model.url,
      installedAt: new Date().toISOString(),
      installedFile: identity,
    });
  }

  async #acquireInstallLock(): Promise<string> {
    const lockPath = join(this.runtimeDir!, "install.lock");
    await mkdir(this.runtimeDir!, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = randomUUID();
      const temporary = `${lockPath}.${token}.tmp`;
      await writeFile(
        temporary,
        `${JSON.stringify({
          version: 1,
          token,
          pid: process.pid,
          createdAt: new Date().toISOString(),
        })}\n`,
        { mode: 0o600 },
      );
      try {
        await link(temporary, lockPath);
        await unlink(temporary);
        return token;
      } catch (error) {
        await unlink(temporary).catch(() => {});
        if (errorCode(error) !== "EEXIST") throw error;
      }
      const existing = await readJsonIfPresent(lockPath);
      const createdAt =
        typeof existing?.["createdAt"] === "string"
          ? Date.parse(existing["createdAt"])
          : Number.NaN;
      const pid =
        typeof existing?.["pid"] === "number" &&
        Number.isSafeInteger(existing["pid"]) &&
        existing["pid"] > 0
          ? existing["pid"]
          : null;
      const stale =
        !pid ||
        !Number.isFinite(createdAt) ||
        Date.now() - createdAt > INSTALL_LOCK_MAX_AGE_MS ||
        !processIsAlive(pid);
      if (!stale) {
        throw new Error("managed model installation is already in progress");
      }
      await unlink(lockPath).catch((error) => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
    }
    throw new Error("could not acquire managed model installation lock");
  }

  async #releaseInstallLock(token: string): Promise<void> {
    const lockPath = join(this.runtimeDir!, "install.lock");
    const lock = await readJsonIfPresent(lockPath);
    if (lock?.["token"] === token) {
      await unlink(lockPath).catch((error) => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
    }
  }
}
