import { spawnSync } from "node:child_process";
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
const binariesTarget = join(tauriRoot, "binaries");
const apiEntry = join(apiTarget, "dist", "src", "server.js");
const nativeKeyringTarget = join(nativeTarget, "bridge-keyring.dylib");
export const MAC_NATIVE_KEYRING_LOADER = `"use strict";
const nativePath = process.env.BRIDGE_KEYRING_NATIVE_LIBRARY;
if (!nativePath) {
  throw new Error("BRIDGE_KEYRING_NATIVE_LIBRARY is required");
}
const binding = { exports: {} };
process.dlopen(binding, nativePath);
module.exports = binding.exports;
`;

export function unsupportedInstallerReason(platform = process.platform) {
  return platform === "win32"
    ? "Windows installers are disabled until the managed API can inherit a reserved loopback listener securely"
    : null;
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
  };
}

async function verifyInputs() {
  const expected = await expectedInputs();
  const manifest = JSON.parse(await readFile(expected.manifestPath, "utf8"));
  const expectedNativeKeyring =
    process.platform === "darwin" ? "Frameworks/bridge-keyring.dylib" : null;
  if (
    manifest.target !== expected.target ||
    manifest.nodeVersion !== process.version ||
    manifest.apiEntry !== "dist/src/server.js" ||
    manifest.dependencyLayout !== "hoisted" ||
    manifest.platform !== process.platform ||
    manifest.architecture !== process.arch ||
    manifest.nativeKeyring !== expectedNativeKeyring
  ) {
    throw new Error("desktop bundle inputs are stale for this Node/Rust target");
  }
  const requiredPaths = [apiEntry, expected.nodeTarget, expected.licensePath];
  if (expected.nativeKeyringTarget) requiredPaths.push(expected.nativeKeyringTarget);
  if (expected.nativeKeyringLoader) requiredPaths.push(expected.nativeKeyringLoader);
  await Promise.all(requiredPaths.map((path) => access(path, constants.R_OK)));
  if (
    expected.nativeKeyringLoader &&
    (await readFile(expected.nativeKeyringLoader, "utf8")) !==
      MAC_NATIVE_KEYRING_LOADER
  ) {
    throw new Error("desktop keyring loader does not match the reviewed bridge");
  }
  await assertNoSensitiveRuntimeFiles(apiTarget);
  if (process.platform === "darwin") {
    await assertNoMacNativeAddonsInResources(apiTarget);
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
    rm(binariesTarget, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(apiTarget, { recursive: true }),
    mkdir(join(licensesTarget, "node"), { recursive: true }),
    mkdir(nativeTarget, { recursive: true }),
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
  if ((await lstat(join(apiTarget, "node_modules", "fastify"))).isSymbolicLink()) {
    throw new Error("the portable API dependency tree must not use symlinks");
  }
  await extractMacNativeKeyring();
  await assertNoSensitiveRuntimeFiles(apiTarget);

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
      },
      null,
      2,
    )}\n`,
  );
  await Promise.all([
    writeFile(join(apiTarget, ".gitkeep"), ""),
    writeFile(join(licensesTarget, ".gitkeep"), ""),
    writeFile(join(nativeTarget, ".gitkeep"), ""),
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
