import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const platformRoot = fileURLToPath(new URL("../../..", import.meta.url));
const tauriRoot = join(desktopRoot, "src-tauri");
const generatedRoot = join(tauriRoot, "generated");
const apiTarget = join(generatedRoot, "api");
const licensesTarget = join(generatedRoot, "licenses");
const nativeTarget = join(generatedRoot, "native");
const llamaTarget = join(generatedRoot, "llama");

/**
 * Ship the local model runtime? OFF by default (user directive 2026-09-11:
 * "why are we shipping llama, drop local models for now").
 *
 * The llama.cpp runtime is 49MB of the bundle. No model WEIGHTS were ever
 * bundled — `qwen3-4b` is a separate, user-triggered download — so this is the
 * whole local-inference cost at install time. What it buys is the capture and
 * sensor lane, which `wiring.ts` binds to local models with no cloud fallback
 * by design; without the runtime that lane reports itself unavailable rather
 * than quietly sending raw capture to a cloud provider.
 *
 * A flag rather than a deletion: turning local inference back on is
 * `BRIDGE_BUNDLE_LOCAL_MODELS=1`, not a revert of this commit.
 */
const BUNDLE_LOCAL_MODELS = process.env.BRIDGE_BUNDLE_LOCAL_MODELS === "1";
const binariesTarget = join(tauriRoot, "binaries");
const modelRuntimeManifestPath = join(desktopRoot, "model-runtime-manifest.json");
const apiEntry = join(apiTarget, "dist", "src", "server.js");
const nativeKeyringTarget = join(nativeTarget, "bridge-keyring.dylib");
const nativeSqliteTarget = join(nativeTarget, "bridge-sqlite3.dylib");
export const MAC_NATIVE_KEYRING_LOADER = `"use strict";
const nativePath = process.env.BRIDGE_KEYRING_NATIVE_LIBRARY;
if (!nativePath) {
  throw new Error("BRIDGE_KEYRING_NATIVE_LIBRARY is required");
}
const binding = { exports: {} };
process.dlopen(binding, nativePath);
module.exports = binding.exports;
`;

/** Replaces better-sqlite3's stock lib/binding.js in the DEPLOYED api copy
 * only (the repo's node_modules keeps the upstream prebuild resolution for dev
 * and tests). The darwin prebuild ships as the signed
 * Frameworks/bridge-sqlite3.dylib — same reviewed pattern as bridge-keyring —
 * because macOS native addons must not ride in Resources. The file keeps
 * better-sqlite3's exact `require("./binding").getBinding` contract. */
export const MAC_NATIVE_SQLITE_LOADER = `"use strict";
let DEFAULT_ADDON;
function getBinding(nativeBinding) {
  if (nativeBinding !== null && nativeBinding !== undefined) {
    throw new Error("nativeBinding is not supported in the packaged desktop API");
  }
  if (DEFAULT_ADDON) return DEFAULT_ADDON;
  const nativePath = process.env.BRIDGE_SQLITE3_NATIVE_LIBRARY;
  if (!nativePath) {
    throw new Error("BRIDGE_SQLITE3_NATIVE_LIBRARY is required");
  }
  const binding = { exports: {} };
  process.dlopen(binding, nativePath);
  DEFAULT_ADDON = binding.exports;
  return DEFAULT_ADDON;
}
exports.getBinding = getBinding;
exports.getPrebuildPath = () => null;
`;

export function unsupportedInstallerReason(platform = process.platform) {
  return platform === "win32"
    ? "Windows installers are disabled until the managed API can inherit a reserved loopback listener securely"
    : null;
}

export function llamaAssetForTarget(manifest, target) {
  const assets = manifest?.runtime?.assets;
  const asset = assets?.[target];
  if (
    !asset ||
    typeof asset.url !== "string" ||
    typeof asset.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(asset.sha256) ||
    !["tar.gz", "zip"].includes(asset.archive)
  ) {
    throw new Error(`no pinned llama.cpp runtime asset for ${target}`);
  }
  return asset;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  const file = await readFile(path);
  hash.update(file);
  return hash.digest("hex");
}

export function macRuntimeSigningArgs(path, identity, keychain) {
  return [
    "--force",
    ...(identity === "-" ? [] : ["--options", "runtime", "--timestamp"]),
    ...(keychain ? ["--keychain", keychain] : []),
    "--sign",
    identity,
    path,
  ];
}

export function macRuntimeSigningConfig(
  environment = process.env,
  platform = process.platform,
) {
  if (platform !== "darwin") return null;
  const release = environment.BRIDGE_RELEASE_SIGNING === "1";
  const identity = environment.APPLE_SIGNING_IDENTITY?.trim();
  const keychain = environment.BRIDGE_CODESIGN_KEYCHAIN?.trim();
  if (release && (!identity || identity === "-" || !keychain)) {
    throw new Error(
      "release bundle preparation requires an imported Developer ID identity and keychain",
    );
  }
  return release
    ? { identity, keychain }
    : { identity: "-", keychain: undefined };
}

function signMacRuntimeFile(path) {
  const signing = macRuntimeSigningConfig();
  if (!signing) return;
  const signed = spawnSync(
    "codesign",
    macRuntimeSigningArgs(path, signing.identity, signing.keychain),
    { encoding: "utf8" },
  );
  if (signed.status !== 0) {
    throw new Error(
      `failed to sign managed llama.cpp runtime file ${basename(path)}: ${
        signed.stderr || signed.stdout
      }`,
    );
  }
}

export async function prepareLlamaRuntime(target) {
  const manifest = JSON.parse(await readFile(modelRuntimeManifestPath, "utf8"));
  const asset = llamaAssetForTarget(manifest, target);
  const archivePath = join(
    generatedRoot,
    asset.archive === "zip" ? "llama-runtime.zip" : "llama-runtime.tar.gz",
  );
  const extractRoot = join(generatedRoot, "llama-extract");
  await Promise.all([
    rm(llamaTarget, { recursive: true, force: true }),
    rm(extractRoot, { recursive: true, force: true }),
  ]);
  await mkdir(extractRoot, { recursive: true });
  const response = await fetch(asset.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`failed to download pinned llama.cpp runtime: HTTP ${response.status}`);
  }
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()), {
    mode: 0o600,
  });
  const digest = await sha256File(archivePath);
  if (digest !== asset.sha256) {
    throw new Error("pinned llama.cpp runtime archive SHA-256 mismatch");
  }
  const extracted = spawnSync("tar", ["-xf", archivePath, "-C", extractRoot], {
    cwd: platformRoot,
    encoding: "utf8",
  });
  if (extracted.status !== 0) {
    throw new Error(`failed to extract pinned llama.cpp runtime: ${extracted.stderr}`);
  }
  await mkdir(llamaTarget, { recursive: true });
  const copied = [];
  await walkFiles(extractRoot, async (_relativePath, sourcePath) => {
    const name = basename(sourcePath);
    const lower = name.toLowerCase();
    if (
      lower === "llama-server" ||
      lower === "llama-server.exe" ||
      lower === "license" ||
      lower.endsWith(".dylib") ||
      lower.includes(".so") ||
      lower.endsWith(".dll")
    ) {
      await copyFile(sourcePath, join(llamaTarget, name));
      copied.push(name);
    }
  });
  const serverName = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  if (!copied.includes(serverName) || !copied.some((name) => name.toLowerCase() === "license")) {
    throw new Error("pinned llama.cpp runtime archive is missing llama-server or LICENSE");
  }
  if (process.platform !== "win32") {
    await chmod(join(llamaTarget, serverName), 0o755);
  }
  for (const name of copied) {
    if (name === serverName || name.toLowerCase().endsWith(".dylib")) {
      signMacRuntimeFile(join(llamaTarget, name));
    }
  }
  const launched = spawnSync(join(llamaTarget, serverName), ["--version"], {
    cwd: llamaTarget,
    encoding: "utf8",
  });
  if (launched.status !== 0) {
    throw new Error(
      `prepared llama.cpp runtime failed its launch smoke test: ${
        launched.stderr || launched.stdout
      }`,
    );
  }
  const runtimeFiles = {};
  for (const name of copied.sort()) {
    runtimeFiles[name] = await sha256File(join(llamaTarget, name));
  }
  await writeFile(
    join(llamaTarget, "bridge-llama-runtime.json"),
    `${JSON.stringify(
      {
        version: 1,
        target,
        runtimeRelease: manifest.runtime.release,
        runtimeRevision: manifest.runtime.revision,
        archiveSha256: asset.sha256,
        files: runtimeFiles,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await Promise.all([
    rm(archivePath, { force: true }),
    rm(extractRoot, { recursive: true, force: true }),
  ]);
}

export function sensitiveRuntimeFileReason(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const name = basename(normalized).toLowerCase();
  if (name === ".env" || name.startsWith(".env.")) {
    return "environment file";
  }

  const firstParty =
    !normalized.startsWith("node_modules/") ||
    normalized.startsWith("node_modules/@bridge/");
  if (!firstParty) return null;
  if ([".npmrc", ".yarnrc", ".yarnrc.yml", ".pnpmfile.cjs", ".netrc"].includes(name)) {
    return "dependency-manager or network credential file";
  }
  if ([".pem", ".key", ".p8", ".p12", ".pfx"].includes(extname(name))) {
    return "private key or certificate container";
  }
  if (
    name === "id_rsa" ||
    name === "id_ed25519" ||
    /^(credentials?|service-account)(?:[._-].*)?\.json$/u.test(name)
  ) {
    return "credential file";
  }
  return null;
}

async function walkFiles(root, visit, directory = root) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = path.slice(root.length + 1);
    if (entry.isDirectory()) {
      await walkFiles(root, visit, path);
    } else {
      await visit(relativePath, path);
    }
  }
}

export async function assertNoSensitiveRuntimeFiles(root) {
  const findings = [];
  await walkFiles(root, async (relativePath) => {
    const reason = sensitiveRuntimeFileReason(relativePath);
    if (reason) findings.push(`${relativePath} (${reason})`);
  });
  if (findings.length > 0) {
    throw new Error(
      `desktop API bundle contains forbidden sensitive files:\n${findings
        .sort()
        .map((finding) => `- ${finding}`)
        .join("\n")}`,
    );
  }
}

async function assertNoMacNativeAddonsInResources(root) {
  const findings = [];
  await walkFiles(root, async (relativePath) => {
    if (relativePath.endsWith(".node")) findings.push(relativePath);
  });
  if (findings.length > 0) {
    throw new Error(
      `macOS native addons must be bundled as signed Frameworks, not Resources:\n${findings
        .sort()
        .map((finding) => `- ${finding}`)
        .join("\n")}`,
    );
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: platformRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function rustHostTriple() {
  const result = spawnSync("rustc", ["-vV"], {
    cwd: platformRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error("rustc -vV failed while resolving the desktop target");
  }
  const host = result.stdout
    .split(/\r?\n/u)
    .find((line) => line.startsWith("host: "))
    ?.slice("host: ".length);
  if (!host) throw new Error("rustc did not report a host target triple");
  return host;
}

function assertNativeTarget(target) {
  const expectedPlatform =
    process.platform === "darwin"
      ? "apple-darwin"
      : process.platform === "win32"
        ? "windows"
        : process.platform === "linux"
          ? "linux"
          : null;
  const expectedArch =
    process.arch === "arm64"
      ? "aarch64"
      : process.arch === "x64"
        ? "x86_64"
        : null;
  if (
    !expectedPlatform ||
    !expectedArch ||
    !target.includes(expectedPlatform) ||
    !target.startsWith(`${expectedArch}-`)
  ) {
    throw new Error(
      `desktop bundles require a native Node runtime; Node is ${process.platform}/${process.arch}, Rust target is ${target}`,
    );
  }
}

async function firstReadable(paths) {
  for (const path of paths) {
    try {
      await access(path, constants.R_OK);
      return path;
    } catch {
      // Continue through the fixed local candidates.
    }
  }
  return null;
}

async function expectedInputs() {
  const unsupported = unsupportedInstallerReason();
  if (unsupported) throw new Error(unsupported);
  const target = process.env.TAURI_ENV_TARGET_TRIPLE ?? rustHostTriple();
  assertNativeTarget(target);
  const extension = process.platform === "win32" ? ".exe" : "";
  return {
    target,
    nodeTarget: join(binariesTarget, `bridge-node-${target}${extension}`),
    manifestPath: join(apiTarget, "bridge-runtime.json"),
    licensePath: join(licensesTarget, "node", "LICENSE"),
    nativeKeyringTarget:
      process.platform === "darwin" ? nativeKeyringTarget : null,
    nativeKeyringLoader:
      process.platform === "darwin"
        ? join(
            apiTarget,
            "node_modules",
            "@napi-rs",
            `keyring-darwin-${process.arch === "arm64" ? "arm64" : "x64"}`,
            "bridge-loader.cjs",
          )
        : null,
    nativeSqliteTarget:
      process.platform === "darwin" ? nativeSqliteTarget : null,
    nativeSqliteLoader:
      process.platform === "darwin"
        ? join(apiTarget, "node_modules", "better-sqlite3", "lib", "binding.js")
        : null,
    llamaRuntimeManifest: join(llamaTarget, "bridge-llama-runtime.json"),
    llamaServer: join(
      llamaTarget,
      process.platform === "win32" ? "llama-server.exe" : "llama-server",
    ),
    llamaLicense: join(llamaTarget, "LICENSE"),
  };
}

async function verifyInputs() {
  const expected = await expectedInputs();
  const manifest = JSON.parse(await readFile(expected.manifestPath, "utf8"));
  const expectedNativeKeyring =
    process.platform === "darwin" ? "Frameworks/bridge-keyring.dylib" : null;
  const expectedNativeSqlite =
    process.platform === "darwin" ? "Frameworks/bridge-sqlite3.dylib" : null;
  if (
    manifest.target !== expected.target ||
    manifest.nodeVersion !== process.version ||
    manifest.apiEntry !== "dist/src/server.js" ||
    manifest.dependencyLayout !== "hoisted" ||
    manifest.platform !== process.platform ||
    manifest.architecture !== process.arch ||
    manifest.nativeKeyring !== expectedNativeKeyring ||
    manifest.nativeSqlite !== expectedNativeSqlite
  ) {
    throw new Error("desktop bundle inputs are stale for this Node/Rust target");
  }
  const requiredPaths = [
    apiEntry,
    // The accounting store runs drizzle's file-based migrator at API startup;
    // a bundle without its migrations folder boots an API that dies before
    // reporting a port (found live 2026-08-27 — apps/api's `files` whitelist
    // had excluded it from `pnpm deploy`). Fail the build, not the launch.
    join(apiTarget, "migrations-accounting", "meta", "_journal.json"),
    expected.nodeTarget,
    expected.licensePath,
    modelRuntimeManifestPath,
  ];
  if (BUNDLE_LOCAL_MODELS) {
    requiredPaths.push(
      expected.llamaRuntimeManifest,
      expected.llamaServer,
      expected.llamaLicense,
    );
  }
  if (expected.nativeKeyringTarget) requiredPaths.push(expected.nativeKeyringTarget);
  if (expected.nativeKeyringLoader) requiredPaths.push(expected.nativeKeyringLoader);
  if (expected.nativeSqliteTarget) requiredPaths.push(expected.nativeSqliteTarget);
  if (expected.nativeSqliteLoader) requiredPaths.push(expected.nativeSqliteLoader);
  await Promise.all(requiredPaths.map((path) => access(path, constants.R_OK)));
  if (
    expected.nativeKeyringLoader &&
    (await readFile(expected.nativeKeyringLoader, "utf8")) !==
      MAC_NATIVE_KEYRING_LOADER
  ) {
    throw new Error("desktop keyring loader does not match the reviewed bridge");
  }
  if (
    expected.nativeSqliteLoader &&
    (await readFile(expected.nativeSqliteLoader, "utf8")) !==
      MAC_NATIVE_SQLITE_LOADER
  ) {
    throw new Error("desktop sqlite loader does not match the reviewed bridge");
  }
  await assertNoSensitiveRuntimeFiles(apiTarget);
  if (process.platform === "darwin") {
    await assertNoMacNativeAddonsInResources(apiTarget);
  }
  if (!BUNDLE_LOCAL_MODELS) return;
  const llamaManifest = JSON.parse(
    await readFile(expected.llamaRuntimeManifest, "utf8"),
  );
  const releaseManifest = JSON.parse(
    await readFile(modelRuntimeManifestPath, "utf8"),
  );
  const llamaAsset = llamaAssetForTarget(releaseManifest, expected.target);
  const runtimeFiles = Object.entries(llamaManifest.files ?? {});
  if (
    runtimeFiles.length === 0 ||
    !runtimeFiles.some(([name]) => name === basename(expected.llamaServer))
  ) {
    throw new Error("desktop llama.cpp runtime file inventory is missing");
  }
  if (
    llamaManifest.target !== expected.target ||
    llamaManifest.runtimeRelease !== releaseManifest.runtime.release ||
    llamaManifest.runtimeRevision !== releaseManifest.runtime.revision ||
    llamaManifest.archiveSha256 !== llamaAsset.sha256
  ) {
    throw new Error("desktop llama.cpp runtime inputs are stale or wrong-target");
  }
  for (const [name, digest] of runtimeFiles) {
    if (
      typeof name !== "string" ||
      basename(name) !== name ||
      typeof digest !== "string" ||
      !/^[0-9a-f]{64}$/u.test(digest) ||
      digest !== (await sha256File(join(llamaTarget, name)))
    ) {
      throw new Error(`desktop llama.cpp runtime file ${name} failed integrity verification`);
    }
  }
}

async function extractMacNativeKeyring() {
  if (process.platform !== "darwin") return;
  const architecture = process.arch === "arm64" ? "arm64" : "x64";
  const dependencyRoot = join(
    apiTarget,
    "node_modules",
    "@napi-rs",
    `keyring-darwin-${architecture}`,
  );
  const source = join(dependencyRoot, `keyring.darwin-${architecture}.node`);
  const dependencyManifestPath = join(dependencyRoot, "package.json");
  const loaderPath = join(dependencyRoot, "bridge-loader.cjs");
  await access(source, constants.R_OK);
  await copyFile(source, nativeKeyringTarget);
  await rm(source, { force: true });
  const dependencyManifest = JSON.parse(
    await readFile(dependencyManifestPath, "utf8"),
  );
  dependencyManifest.main = "bridge-loader.cjs";
  await Promise.all([
    writeFile(loaderPath, MAC_NATIVE_KEYRING_LOADER),
    writeFile(
      dependencyManifestPath,
      `${JSON.stringify(dependencyManifest, null, 2)}\n`,
    ),
  ]);
}

/** better-sqlite3 (accounting/d2c Module stores) ships prebuilds/*.node inside
 * its npm package. On macOS the darwin prebuild moves into the signed
 * Frameworks directory and every prebuild is stripped from Resources; the
 * loader written over lib/binding.js dlopens the Framework via
 * BRIDGE_SQLITE3_NATIVE_LIBRARY (set by the desktop shell, next to the
 * keyring's identical wiring). */
async function extractMacNativeSqlite() {
  if (process.platform !== "darwin") return;
  const architecture = process.arch === "arm64" ? "arm64" : "x64";
  const dependencyRoot = join(apiTarget, "node_modules", "better-sqlite3");
  const source = join(dependencyRoot, "prebuilds", `darwin-${architecture}.node`);
  const bindingPath = join(dependencyRoot, "lib", "binding.js");
  await access(source, constants.R_OK);
  await access(bindingPath, constants.R_OK);
  await copyFile(source, nativeSqliteTarget);
  await rm(join(dependencyRoot, "prebuilds"), { recursive: true, force: true });
  await writeFile(bindingPath, MAC_NATIVE_SQLITE_LOADER);
}

/** pdfjs-dist lists @napi-rs/canvas as an OPTIONAL dependency and the
 * accounting Module reads only text positions — never a rendered glyph (its
 * pdf.ts shims DOMMatrix/Path2D before import for exactly this reason). The
 * canvas addon therefore has no sanctioned macOS load path and is pruned from
 * the bundle rather than promoted to a Framework nothing uses. */
async function pruneMacOptionalCanvas() {
  if (process.platform !== "darwin") return;
  const napiRoot = join(apiTarget, "node_modules", "@napi-rs");
  let entries;
  try {
    entries = await readdir(napiRoot, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.name === "canvas" || entry.name.startsWith("canvas-"),
      )
      .map((entry) =>
        rm(join(napiRoot, entry.name), { recursive: true, force: true }),
      ),
  );
}

async function prepare() {
  const expected = await expectedInputs();
  run(pnpm, [
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=...@bridge/api",
    "--filter=...@bridge/web",
  ]);

  await Promise.all([
    rm(apiTarget, { recursive: true, force: true }),
    rm(licensesTarget, { recursive: true, force: true }),
    rm(nativeTarget, { recursive: true, force: true }),
    rm(llamaTarget, { recursive: true, force: true }),
    rm(binariesTarget, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(apiTarget, { recursive: true }),
    mkdir(join(licensesTarget, "node"), { recursive: true }),
    mkdir(nativeTarget, { recursive: true }),
    mkdir(llamaTarget, { recursive: true }),
    mkdir(binariesTarget, { recursive: true }),
  ]);

  run(pnpm, [
    "--config.node-linker=hoisted",
    "--filter",
    "@bridge/api",
    "deploy",
    "--prod",
    "--legacy",
    apiTarget,
  ]);
  await rm(join(apiTarget, "node_modules", ".bin"), {
    recursive: true,
    force: true,
  });
  // `@trpc/server` declares `typescript` as a PEER dependency, and pnpm
  // installs peers automatically — so `--prod` still dragged the 23MB
  // TypeScript compiler into a bundle that only ever runs compiled JS. It is
  // a types-only peer: a grep of the whole deployed tree for a runtime
  // `require("typescript")` / `from "typescript"` across .js/.mjs/.cjs
  // returned nothing (2026-09-11), which is why this is safe to drop.
  await rm(join(apiTarget, "node_modules", "typescript"), {
    recursive: true,
    force: true,
  });
  if ((await lstat(join(apiTarget, "node_modules", "fastify"))).isSymbolicLink()) {
    throw new Error("the portable API dependency tree must not use symlinks");
  }
  await extractMacNativeKeyring();
  await extractMacNativeSqlite();
  await pruneMacOptionalCanvas();
  await assertNoSensitiveRuntimeFiles(apiTarget);
  if (BUNDLE_LOCAL_MODELS) await prepareLlamaRuntime(expected.target);

  await copyFile(process.execPath, expected.nodeTarget);
  if (process.platform !== "win32") await chmod(expected.nodeTarget, 0o755);
  const nodeLicense = await firstReadable([
    join(dirname(process.execPath), "LICENSE"),
    join(dirname(process.execPath), "..", "LICENSE"),
    join(dirname(process.execPath), "..", "..", "LICENSE"),
  ]);
  if (!nodeLicense) {
    throw new Error(`could not locate the Node ${process.version} license`);
  }
  await copyFile(nodeLicense, expected.licensePath);
  await writeFile(
    expected.manifestPath,
    `${JSON.stringify(
      {
        apiEntry: "dist/src/server.js",
        dependencyLayout: "hoisted",
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        target: expected.target,
        nativeKeyring:
          process.platform === "darwin"
            ? "Frameworks/bridge-keyring.dylib"
            : null,
        nativeSqlite:
          process.platform === "darwin"
            ? "Frameworks/bridge-sqlite3.dylib"
            : null,
      },
      null,
      2,
    )}\n`,
  );
  await Promise.all([
    writeFile(join(apiTarget, ".gitkeep"), ""),
    writeFile(join(licensesTarget, ".gitkeep"), ""),
    writeFile(join(nativeTarget, ".gitkeep"), ""),
    writeFile(join(llamaTarget, ".gitkeep"), ""),
    writeFile(join(binariesTarget, ".gitkeep"), ""),
  ]);
  await verifyInputs();
}

async function main() {
  if (
    process.argv.includes("--verify-only") ||
    process.env.BRIDGE_DESKTOP_BUNDLE_PREPARED === "1"
  ) {
    await verifyInputs();
  } else {
    await prepare();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
