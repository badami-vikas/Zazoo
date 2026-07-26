import { spawn, spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const platformRoot = new URL("../../..", import.meta.url);
const host = process.env.BRIDGE_WEB_DEV_HOST ?? "127.0.0.1";
const port = process.env.BRIDGE_WEB_DEV_PORT ?? "5173";

const build = spawnSync(
  pnpm,
  [
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=...@bridge/api",
    "--filter=...@bridge/web",
  ],
  { cwd: platformRoot, stdio: "inherit" },
);
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const vite = spawn(
  pnpm,
  [
    "--filter",
    "@bridge/web",
    "dev",
    "--host",
    host,
    "--port",
    port,
    "--strictPort",
  ],
  { cwd: platformRoot, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => vite.kill(signal));
}
vite.on("error", (error) => {
  console.error(`[bridge-desktop] could not start Vite: ${error.message}`);
  process.exit(1);
});
vite.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
