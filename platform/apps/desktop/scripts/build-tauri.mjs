import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));

export function localMacSigningConfig(platform, signingIdentity) {
  if (
    platform !== "darwin" ||
    (signingIdentity?.trim() && signingIdentity.trim() !== "-")
  ) {
    return null;
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
  const config = localMacSigningConfig(
    process.platform,
    process.env.APPLE_SIGNING_IDENTITY,
  );
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
      ...(config ? { APPLE_SIGNING_IDENTITY: "-" } : {}),
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
