import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  GuardedDownloadOptions,
  GuardedDownloadResult,
} from "@bridge/net-guard";
import { MANAGED_LLAMA_MODEL_ID } from "@bridge/models";
import { ManagedModelService } from "../src/chat/model-manager.js";

const modelContents = Buffer.from("good");
const modelDigest = createHash("sha256").update(modelContents).digest("hex");

function runtimeManifest() {
  return {
    version: 1,
    runtime: {
      release: "b9000",
      revision: "1a03cf47f67be591699d1f0f7ca28e1ed6eb8c7e",
      license: "MIT",
    },
    model: {
      providerModelId: MANAGED_LLAMA_MODEL_ID,
      repository: "test/model",
      repositoryRevision: "revision",
      fileCommit: "commit",
      file: "model.gguf",
      bytes: modelContents.byteLength,
      sha256: modelDigest,
      license: "Apache-2.0",
      quantizedWith: "llama.cpp b6096",
      url: "https://models.example/model.gguf",
      allowedRedirectOrigins: ["https://models.example"],
    },
  };
}

async function setupModelManager() {
  const root = await mkdtemp(join(tmpdir(), "bridge-model-manager-"));
  const localDir = join(root, "local");
  const manifestPath = join(root, "model-runtime-manifest.json");
  await writeFile(manifestPath, JSON.stringify(runtimeManifest()));
  const provider = {
    async probe() {
      return "unavailable" as const;
    },
  };
  return {
    root,
    localDir,
    manifestPath,
    provider,
    modelPath: join(localDir, "model-runtime", "models", "model.gguf"),
    runtimeDir: join(localDir, "model-runtime"),
  };
}

async function waitForState(
  service: ManagedModelService,
  expected: "failed" | "loading",
) {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const status = await service.status();
    if (status.state === expected) return status;
    if (Date.now() >= deadline) {
      assert.fail(`model manager did not reach ${expected}; last state was ${status.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("managed model start rejects a same-size file with the wrong digest", async () => {
  const setup = await setupModelManager();
  try {
    await mkdir(join(setup.runtimeDir, "models"), { recursive: true });
    await writeFile(setup.modelPath, "evil");
    const service = new ManagedModelService(setup);

    await assert.rejects(
      () => service.requestStart(),
      /SHA-256 does not match/,
    );
    await assert.rejects(
      () => stat(join(setup.runtimeDir, "start.request")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test("managed model verifies an existing model file before creating its start request", async () => {
  const setup = await setupModelManager();
  try {
    await mkdir(join(setup.runtimeDir, "models"), { recursive: true });
    await writeFile(setup.modelPath, modelContents);
    const service = new ManagedModelService(setup);

    const status = await service.install();
    assert.equal(status.state, "loading");
    const receipt = JSON.parse(
      await readFile(join(setup.runtimeDir, "installation.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(receipt["sha256"], modelDigest);
    assert.equal(typeof receipt["installedFile"], "object");
    await stat(join(setup.runtimeDir, "start.request"));
    await assert.rejects(
      () => stat(join(setup.runtimeDir, "install.lock")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test("managed model install rejects a live cross-process lock", async () => {
  const setup = await setupModelManager();
  try {
    await mkdir(setup.runtimeDir, { recursive: true });
    await writeFile(
      join(setup.runtimeDir, "install.lock"),
      JSON.stringify({
        version: 1,
        token: "other-install",
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }),
    );
    const service = new ManagedModelService(setup);

    await assert.rejects(
      () => service.install(),
      /already in progress/,
    );
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test("managed model install persists failure and permits a verified retry", async () => {
  const setup = await setupModelManager();
  let attempts = 0;
  const downloadToFile = async (
    _url: string,
    partialPath: string,
    options: GuardedDownloadOptions,
  ): Promise<GuardedDownloadResult> => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary download failure");
    await writeFile(partialPath, modelContents);
    options.onProgress?.({
      downloadedBytes: modelContents.byteLength,
      expectedBytes: modelContents.byteLength,
    });
    return {
      finalUrl: "https://models.example/model.gguf",
      bytes: modelContents.byteLength,
      sha256: modelDigest,
      resumedFrom: 0,
      redirectCount: 0,
      hopOrigins: ["https://models.example"],
    };
  };
  try {
    const service = new ManagedModelService({ ...setup, downloadToFile });

    assert.equal((await service.install()).state, "downloading");
    assert.equal((await waitForState(service, "failed")).errorCode, "model_install_failed");
    assert.equal((await service.install()).state, "downloading");
    assert.equal((await waitForState(service, "loading")).downloadedBytes, modelContents.byteLength);
    assert.equal(attempts, 2);
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test("managed model install reports an explicit cancellation", async () => {
  const setup = await setupModelManager();
  const downloadToFile = async (
    _url: string,
    _partialPath: string,
    options: GuardedDownloadOptions,
  ): Promise<GuardedDownloadResult> =>
    new Promise((_resolve, reject) => {
      const rejectCancelled = () => {
        const error = new Error("request aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (options.signal?.aborted) {
        rejectCancelled();
        return;
      }
      options.signal?.addEventListener("abort", rejectCancelled, { once: true });
    });
  try {
    const service = new ManagedModelService({ ...setup, downloadToFile });

    assert.equal((await service.install()).state, "downloading");
    const cancelled = await service.cancelInstall();
    assert.equal(cancelled.state, "failed");
    assert.equal(cancelled.errorCode, "download_cancelled");
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});

test("cancellation after download completion cannot promote or start the model", async () => {
  const setup = await setupModelManager();
  let finishDownload!: () => void;
  const downloadCanFinish = new Promise<void>((resolve) => {
    finishDownload = resolve;
  });
  let downloadStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    downloadStarted = resolve;
  });
  const downloadToFile = async (
    _url: string,
    partialPath: string,
    _options: GuardedDownloadOptions,
  ): Promise<GuardedDownloadResult> => {
    await writeFile(partialPath, modelContents);
    downloadStarted();
    await downloadCanFinish;
    return {
      finalUrl: "https://models.example/model.gguf",
      bytes: modelContents.byteLength,
      sha256: modelDigest,
      resumedFrom: 0,
      redirectCount: 0,
      hopOrigins: ["https://models.example"],
    };
  };
  try {
    const service = new ManagedModelService({ ...setup, downloadToFile });
    assert.equal((await service.install()).state, "downloading");
    await started;
    const cancelling = service.cancelInstall();
    finishDownload();
    const cancelled = await cancelling;
    assert.equal(cancelled.state, "failed");
    assert.equal(cancelled.errorCode, "download_cancelled");
    await assert.rejects(() => stat(setup.modelPath), { code: "ENOENT" });
    await assert.rejects(
      () => stat(join(setup.runtimeDir, "installation.json")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      () => stat(join(setup.runtimeDir, "start.request")),
      { code: "ENOENT" },
    );
    assert.equal(
      (await stat(`${setup.modelPath}.part`)).size,
      modelContents.byteLength,
    );
  } finally {
    await rm(setup.root, { recursive: true, force: true });
  }
});
