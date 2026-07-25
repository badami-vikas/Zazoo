import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("macOS bundle verification must run on macOS");
}

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const app = process.env.BRIDGE_MACOS_APP_PATH ??
  join(desktopRoot, "src-tauri/target/release/bundle/macos/Bridge.app");
const node = join(app, "Contents/MacOS/bridge-node");
const keyring = join(app, "Contents/Frameworks/bridge-keyring.dylib");
const apiResources = join(app, "Contents/Resources/api");
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

await Promise.all(
  [app, node, keyring, keyringModule, apiResources].map((path) =>
    access(path, constants.R_OK),
  ),
);
const unsignedResourceAddons = await findNativeAddons(apiResources);
if (unsignedResourceAddons.length > 0) {
  throw new Error("native addons remain in unsigned API Resources");
}

const signedBuild = Boolean(process.env.APPLE_SIGNING_IDENTITY?.trim());
for (const path of signedBuild ? [node, keyring, app] : [node, keyring]) {
  runCodesign(["--verify", "--strict", "--verbose=2", path]);
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

if (signedBuild) {
  const teams = [teamIdentifier(app), teamIdentifier(node), teamIdentifier(keyring)];
  if (teams.some((team) => !team) || new Set(teams).size !== 1) {
    throw new Error("signed app, Node runtime, and native keyring must share one Team ID");
  }
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
