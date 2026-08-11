import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAC_NATIVE_KEYRING_LOADER,
  macRuntimeSigningArgs,
  macRuntimeSigningConfig,
  sensitiveRuntimeFileReason,
  unsupportedInstallerReason,
  llamaAssetForTarget,
} from "./prepare-bundle.mjs";
import {
  findLlamaCode,
  isReleaseSigningIdentity,
} from "./verify-macos-bundle.mjs";
import { firstCodesignIdentity } from "./import-macos-certificate.mjs";
import { detectLocalSigningIdentity, localMacSigningConfig } from "./build-tauri.mjs";

const modelRuntimeManifest = JSON.parse(
  readFileSync(new URL("../model-runtime-manifest.json", import.meta.url), "utf8"),
);
const tauriConfig = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const certificateImporter = readFileSync(
  new URL("./import-macos-certificate.mjs", import.meta.url),
  "utf8",
);

test("portable API rejects environment and first-party credential files", () => {
  assert.equal(sensitiveRuntimeFileReason(".env"), "environment file");
  assert.equal(
    sensitiveRuntimeFileReason("node_modules/@bridge/api/.env.local"),
    "environment file",
  );
  assert.equal(
    sensitiveRuntimeFileReason("node_modules/@bridge/db/service-account.json"),
    "credential file",
  );
  assert.equal(
    sensitiveRuntimeFileReason("node_modules/@bridge/api/release-key.pem"),
    "private key or certificate container",
  );
  assert.equal(
    sensitiveRuntimeFileReason("node_modules/example/public-ca.pem"),
    null,
  );
});

test("supported installer preparation fails closed on Windows", () => {
  assert.match(unsupportedInstallerReason("win32"), /Windows installers are disabled/);
  assert.equal(unsupportedInstallerReason("darwin"), null);
  assert.equal(unsupportedInstallerReason("linux"), null);
});

test("macOS keyring loader delegates to the signed Framework without the broken generated-loader override", () => {
  assert.match(MAC_NATIVE_KEYRING_LOADER, /BRIDGE_KEYRING_NATIVE_LIBRARY/);
  assert.match(MAC_NATIVE_KEYRING_LOADER, /process\.dlopen/);
  assert.doesNotMatch(MAC_NATIVE_KEYRING_LOADER, /NAPI_RS_NATIVE_LIBRARY_PATH/);
});

test("ad-hoc llama signing omits hardened runtime while release signing retains it", () => {
  assert.deepEqual(macRuntimeSigningArgs("/tmp/llama-server", "-"), [
    "--force",
    "--sign",
    "-",
    "/tmp/llama-server",
  ]);
  assert.deepEqual(
    macRuntimeSigningArgs(
      "/tmp/llama-server",
      "Developer ID Application: Bridge",
      "/tmp/bridge.keychain-db",
    ),
    [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--keychain",
      "/tmp/bridge.keychain-db",
      "--sign",
      "Developer ID Application: Bridge",
      "/tmp/llama-server",
    ],
  );
  assert.deepEqual(macRuntimeSigningConfig({}, "darwin"), {
    identity: "-",
    keychain: undefined,
  });
  assert.deepEqual(
    macRuntimeSigningConfig(
      {
        BRIDGE_RELEASE_SIGNING: "1",
        APPLE_SIGNING_IDENTITY: "Developer ID Application: Bridge",
        BRIDGE_CODESIGN_KEYCHAIN: "/tmp/bridge.keychain-db",
      },
      "darwin",
    ),
    {
      identity: "Developer ID Application: Bridge",
      keychain: "/tmp/bridge.keychain-db",
    },
  );
  assert.throws(
    () =>
      macRuntimeSigningConfig(
        { BRIDGE_RELEASE_SIGNING: "1" },
        "darwin",
      ),
    /requires an imported Developer ID identity and keychain/,
  );
  assert.equal(
    firstCodesignIdentity(
      '  1) ABCDEF0123456789 "Developer ID Application: Bridge (TEAMID)"\n',
    ),
    "Developer ID Application: Bridge (TEAMID)",
  );
});

test("macOS bundles are ad-hoc signed locally while Developer ID builds retain release checks", () => {
  assert.equal(tauriConfig.bundle.macOS.signingIdentity, undefined);
  assert.equal(isReleaseSigningIdentity(undefined), false);
  assert.equal(isReleaseSigningIdentity(""), false);
  assert.equal(isReleaseSigningIdentity("-"), false);
  assert.equal(
    isReleaseSigningIdentity("Developer ID Application: Bridge"),
    true,
  );
  assert.deepEqual(localMacSigningConfig("darwin", undefined), {
    bundle: {
      macOS: {
        hardenedRuntime: false,
        signingIdentity: "-",
      },
    },
  });
  assert.deepEqual(localMacSigningConfig("darwin", "-"), {
    bundle: {
      macOS: {
        hardenedRuntime: false,
        signingIdentity: "-",
      },
    },
  });
  assert.equal(
    localMacSigningConfig("darwin", "Developer ID Application: Bridge"),
    null,
  );
  assert.equal(localMacSigningConfig("linux", undefined), null);
  assert.match(certificateImporter, /BRIDGE_RELEASE_SIGNING=1/);

  // K7 unblock (ADR-228): a "Bridge Dev Signing" cert in the keychain makes
  // local builds sign with a STABLE designated requirement (TCC-durable),
  // hardened runtime off (self-signed = no Team ID = library validation
  // would reject our own dylibs). Explicit env always wins over detection.
  assert.equal(detectLocalSigningIdentity(""), null);
  assert.equal(detectLocalSigningIdentity(undefined), null);
  assert.equal(
    detectLocalSigningIdentity('  1) 48868B88 "Bridge Dev Signing" (CSSMERR_TP_NOT_TRUSTED)'),
    "Bridge Dev Signing",
  );
  assert.deepEqual(localMacSigningConfig("darwin", undefined, "Bridge Dev Signing"), {
    bundle: {
      macOS: {
        hardenedRuntime: false,
        signingIdentity: "Bridge Dev Signing",
      },
    },
  });
  // An explicit ad-hoc request beats the detected local identity.
  assert.deepEqual(localMacSigningConfig("darwin", "-", "Bridge Dev Signing"), {
    bundle: {
      macOS: {
        hardenedRuntime: false,
        signingIdentity: "-",
      },
    },
  });
  // An explicit release identity beats it too, and stays untouched.
  assert.equal(
    localMacSigningConfig("darwin", "Developer ID Application: Bridge", "Bridge Dev Signing"),
    null,
  );
  // The local identity is NOT a release identity (no Team ID to assert).
  assert.equal(isReleaseSigningIdentity("Bridge Dev Signing"), false);
});

test("macOS bundle verification discovers the packaged llama executable and libraries", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-llama-verifier-"));
  try {
    await mkdir(join(root, "nested"));
    await Promise.all([
      writeFile(join(root, "llama-server"), ""),
      writeFile(join(root, "libllama.dylib"), ""),
      writeFile(join(root, "LICENSE"), ""),
      writeFile(join(root, "nested", "ignored.dylib"), ""),
    ]);
    assert.deepEqual(
      (await findLlamaCode(root)).map((path) => path.slice(root.length + 1)).sort(),
      ["libllama.dylib", "llama-server"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every supported desktop target has one checksum-pinned llama.cpp runtime asset", () => {
  for (const target of [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "aarch64-unknown-linux-gnu",
    "x86_64-unknown-linux-gnu",
    "aarch64-pc-windows-msvc",
    "x86_64-pc-windows-msvc",
  ]) {
    const asset = llamaAssetForTarget(modelRuntimeManifest, target);
    assert.match(asset.url, /^https:\/\/github\.com\/ggml-org\/llama\.cpp\/releases\/download\/b9000\//u);
    assert.match(asset.sha256, /^[0-9a-f]{64}$/u);
  }
  assert.throws(
    () => llamaAssetForTarget(modelRuntimeManifest, "wasm32-unknown-unknown"),
    /no pinned llama\.cpp runtime asset/,
  );
});

test("managed model manifest pins provenance, bytes, digest, and redirect origins", () => {
  assert.equal(modelRuntimeManifest.runtime.release, "b9000");
  assert.equal(
    modelRuntimeManifest.model.providerModelId,
    "qwen3-4b-instruct-2507-q4_k_m",
  );
  assert.equal(modelRuntimeManifest.model.bytes, 2_497_280_736);
  assert.match(modelRuntimeManifest.model.sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(modelRuntimeManifest.model.allowedRedirectOrigins, [
    "https://huggingface.co",
    "https://us.aws.cdn.hf.co",
  ]);
});
