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

function build() {
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
  const args = [
    join(desktopRoot, "node_modules/@tauri-apps/cli/tauri.js"),
    "build",
    ...process.argv.slice(2),
    ...(config ? ["--config", JSON.stringify(config)] : []),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: desktopRoot,
    env: {
      ...process.env,
      ...(signingIdentity ? { APPLE_SIGNING_IDENTITY: signingIdentity } : {}),
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
