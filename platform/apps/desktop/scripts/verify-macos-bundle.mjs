import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const app = process.env.BRIDGE_MACOS_APP_PATH ??
  join(desktopRoot, "src-tauri/target/release/bundle/macos/Bridge.app");
const node = join(app, "Contents/MacOS/bridge-node");
const keyring = join(app, "Contents/Frameworks/bridge-keyring.dylib");
const apiResources = join(app, "Contents/Resources/api");
const llamaResources = join(app, "Contents/Resources/llama");
const keyringModule = join(
  apiResources,
  "node_modules/@napi-rs/keyring/index.js",
);

function runCodesign(args) {
  const result = spawnSync("codesign", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `codesign ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return `${result.stdout}\n${result.stderr}`;
}

function teamIdentifier(path) {
  const details = runCodesign(["-dv", "--verbose=4", path]);
  return details.match(/^TeamIdentifier=(.+)$/mu)?.[1]?.trim() ?? null;
}

export function isReleaseSigningIdentity(identity) {
  const normalized = identity?.trim();
  // The local dev identity (build-tauri.mjs LOCAL_SIGNING_IDENTITY) is a
  // self-signed cert with no Team ID — a stable-DR local build, not a
  // release build; the shared-Team-ID assertion cannot apply to it.
  return Boolean(
    normalized && normalized !== "-" && normalized !== "Bridge Dev Signing",
  );
}

async function findNativeAddons(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await findNativeAddons(path, found);
    } else if (entry.name.endsWith(".node")) {
      found.push(path);
    }

  }
  return found;
}

export async function findLlamaCode(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      (entry.name === "llama-server" || entry.name.endsWith(".dylib"))
    ) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

export async function verifyMacBundle() {
  if (process.platform !== "darwin") {
    throw new Error("macOS bundle verification must run on macOS");
  }

  await Promise.all(
    [app, node, keyring, keyringModule, apiResources, llamaResources].map((path) =>
      access(path, constants.R_OK),
    ),
  );
  const unsignedResourceAddons = await findNativeAddons(apiResources);
  if (unsignedResourceAddons.length > 0) {
    throw new Error("native addons remain in unsigned API Resources");
  }

  const releaseSignedBuild = isReleaseSigningIdentity(
    process.env.APPLE_SIGNING_IDENTITY,
  );
  const llamaCode = await findLlamaCode(llamaResources);
  const llamaServer = llamaCode.find((path) => path.endsWith("/llama-server"));
  if (!llamaServer || !llamaCode.some((path) => path.endsWith(".dylib"))) {
    throw new Error("packaged llama.cpp runtime code is incomplete");
  }
  runCodesign(["--verify", "--deep", "--strict", "--verbose=2", app]);
  for (const path of [
    node,
    keyring,
    ...llamaCode,
  ]) {
    runCodesign(["--verify", "--strict", "--verbose=2", path]);
  }
  const launched = spawnSync(llamaServer, ["--version"], {
    cwd: llamaResources,
    encoding: "utf8",
  });
  if (launched.status !== 0) {
    throw new Error(
      `packaged llama.cpp runtime failed its launch smoke test: ${
        launched.stderr || launched.stdout
      }`,
    );
  }
  const nodeEntitlements = runCodesign(["-d", "--entitlements", ":-", node]);
  for (const entitlement of [
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
  ]) {
    if (!nodeEntitlements.includes(`<key>${entitlement}</key>`)) {
      throw new Error(`packaged Node is missing ${entitlement}`);
    }
  }

  if (releaseSignedBuild) {
    const teams = [
      teamIdentifier(app),
      teamIdentifier(node),
      teamIdentifier(keyring),
      ...llamaCode.map(teamIdentifier),
    ];
    if (teams.some((team) => !team) || new Set(teams).size !== 1) {
      throw new Error(
        "signed app, Node runtime, native keyring, and llama.cpp runtime must share one Team ID",
      );
    }
  }

  const minimumSystem = spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :LSMinimumSystemVersion", join(app, "Contents/Info.plist")],
    { encoding: "utf8" },
  );
  if (minimumSystem.status !== 0 || minimumSystem.stdout.trim() !== "14.0") {
    throw new Error("packaged app must declare macOS 14.0 as its minimum system version");
  }

  const keyringSmokeEnv = { ...process.env };
  delete keyringSmokeEnv.NAPI_RS_NATIVE_LIBRARY_PATH;
  keyringSmokeEnv.BRIDGE_KEYRING_NATIVE_LIBRARY = keyring;
  const keyringSmoke = spawnSync(
    node,
    [
      "-e",
      `const { AsyncEntry } = require(${JSON.stringify(keyringModule)});` +
        `const entry = new AsyncEntry("ai.bridge.bundle-verify", "native-load");` +
        `if (!entry || typeof entry.getPassword !== "function") process.exit(1);`,
    ],
    {
      encoding: "utf8",
      env: keyringSmokeEnv,
    },
  );
  if (keyringSmoke.status !== 0) {
    throw new Error(
      `packaged keyring failed to load: ${(keyringSmoke.stderr || keyringSmoke.stdout).trim()}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await verifyMacBundle();
}
