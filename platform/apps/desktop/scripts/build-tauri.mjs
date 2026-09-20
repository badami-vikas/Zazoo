import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));

/** The local dev signing identity (K7 unblock, ADR-228). A self-signed
 * code-signing certificate under this Common Name gives every local build
 * the SAME designated requirement (`identifier "ai.bridge.desktop" and
 * certificate root = H"…"`), which is what macOS TCC stores — so
 * Accessibility/Screen grants survive rebuilds, unlike ad-hoc signing
 * whose cdhash-anchored requirement changes with every binary. Created
 * once per machine (openssl codeSigning cert → login keychain); absent
 * cert = ad-hoc fallback, unchanged CI behavior. */
export const LOCAL_SIGNING_IDENTITY = "Bridge Dev Signing";

/** Pick the local identity out of `security find-identity -p codesigning`
 * output. The listing marks a self-signed cert CSSMERR_TP_NOT_TRUSTED —
 * that only affects trust-chain display; codesign signs with it fine. */
export function detectLocalSigningIdentity(listing) {
  return listing?.includes(`"${LOCAL_SIGNING_IDENTITY}"`) ? LOCAL_SIGNING_IDENTITY : null;
}

export function localMacSigningConfig(platform, signingIdentity, localIdentity = null) {
  if (
    platform !== "darwin" ||
    (signingIdentity?.trim() && signingIdentity.trim() !== "-")
  ) {
    // A real release identity is configured: leave tauri's defaults
    // (hardened runtime on) untouched.
    return null;
  }
  if (!signingIdentity?.trim() && localIdentity) {
    // Local stable identity: hardened runtime stays OFF on purpose — a
    // self-signed cert carries no Team ID, so hardened-runtime library
    // validation would reject our own bundled dylibs (keyring, llama).
    // TCC durability needs only the stable designated requirement.
    return {
      bundle: {
        macOS: {
          hardenedRuntime: false,
          signingIdentity: localIdentity,
        },
      },
    };
  }
  return {
    bundle: {
      macOS: {
        hardenedRuntime: false,
        signingIdentity: "-",
      },
    },
  };
}

/** TASK-077's updater artifacts are signed with TAURI_SIGNING_PRIVATE_KEY,
 * which exists only as a CI secret — the repo commits the PUBLIC half. Tauri
 * errors out AFTER bundling when asked to create updater artifacts without
 * the private key, which turned every local `pnpm build:tauri` red. Without
 * the key the build skips updater artifacts instead of demanding a secret a
 * developer machine should never hold. */
export function updaterBundleConfig(environment = process.env) {
  return environment.TAURI_SIGNING_PRIVATE_KEY?.trim()
    ? null
    : { bundle: { createUpdaterArtifacts: false } };
}

/** Device nodes of mounted disk images whose file is a Bridge dmg. Tauri's
 * `bundle_dmg.sh` mounts a volume named after the app and fails outright when
 * one is still attached — a leftover from an interrupted build, or a build in
 * a sibling worktree — so every build detaches those first. Parses `hdiutil
 * info` text so it stays host-testable. */
export function staleBridgeImages(hdiutilInfo) {
  const stale = [];
  let current = null;
  for (const line of hdiutilInfo.split("\n")) {
    const image = line.match(/^image-path\s*:\s*(.+)$/);
    if (image) {
      current = /Bridge_[^/]*\.dmg$/.test(image[1].trim()) ? image[1].trim() : null;
      continue;
    }
    if (line.startsWith("=====")) current = null;
    const device = line.match(/^(\/dev\/disk\d+)(?:s\d+)?\s/);
    if (current && device && !stale.includes(device[1])) stale.push(device[1]);
  }
  return stale;
}

function detachStaleImages() {
  if (process.platform !== "darwin") return;
  const info = spawnSync("hdiutil", ["info"], { encoding: "utf8" }).stdout ?? "";
  for (const device of staleBridgeImages(info)) {
    console.log(`[build-tauri] detaching stale Bridge disk image ${device}`);
    spawnSync("hdiutil", ["detach", device, "-force"], { stdio: "inherit" });
  }
}

function build() {
  detachStaleImages();
  const localIdentity =
    process.platform === "darwin" && !process.env.APPLE_SIGNING_IDENTITY?.trim()
      ? detectLocalSigningIdentity(
          spawnSync("security", ["find-identity", "-p", "codesigning"], {
            encoding: "utf8",
          }).stdout ?? "",
        )
      : null;
  const config = localMacSigningConfig(
    process.platform,
    process.env.APPLE_SIGNING_IDENTITY,
    localIdentity,
  );
  const signingIdentity = config?.bundle.macOS.signingIdentity;
  if (signingIdentity) {
    console.log(
      signingIdentity === "-"
        ? "[build-tauri] no signing identity — ad-hoc signing (TCC grants will NOT survive rebuilds)"
        : `[build-tauri] signing with "${signingIdentity}" — stable designated requirement, TCC grants survive rebuilds`,
    );
  }
  const updaterConfig = updaterBundleConfig();
  if (updaterConfig) {
    console.log(
      "[build-tauri] no TAURI_SIGNING_PRIVATE_KEY — skipping the signed updater bundle (CI publishes it)",
    );
  }
  const mergedConfig =
    config || updaterConfig
      ? {
          bundle: {
            ...(config?.bundle ?? {}),
            ...(updaterConfig?.bundle ?? {}),
          },
        }
      : null;
  const args = [
    join(desktopRoot, "node_modules/@tauri-apps/cli/tauri.js"),
    "build",
    ...process.argv.slice(2),
    ...(mergedConfig ? ["--config", JSON.stringify(mergedConfig)] : []),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: desktopRoot,
    env: {
      ...process.env,
      ...(signingIdentity ? { APPLE_SIGNING_IDENTITY: signingIdentity } : {}),
      // The dmg step's Finder-styling AppleScript leaves the volume "in use",
      // so `hdiutil detach` fails and the whole build is reported red after a
      // complete .app was written (2026-09-20). `CI=true` makes tauri-bundler pass
      // `--skip-jenkins` to its bundle_dmg.sh (a plain dmg, no icon layout);
      // TAURI_BUNDLER_DMG_IGNORE_CI=1 restores the styled dmg for a release.
      CI: process.env.CI ?? "true",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  build();
}
