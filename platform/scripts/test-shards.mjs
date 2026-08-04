/**
 * Sharded single-process test runner.
 *
 * `node --test` isolates every test FILE in its own child process. That is the
 * safe default, but it defeats any per-process warm cache: packages/db's
 * migration snapshot (BRIDGE_DB_TEST_SNAPSHOT, see client-local.ts) has to be
 * rebuilt once per file, so 52 files meant 52 migration replays.
 *
 * `--test-isolation=none` runs every file in ONE process (snapshot built once)
 * but serialises the whole suite, so the CPU saving does not become a wall-clock
 * saving. This script takes both: it splits the files into N groups and runs one
 * `--test-isolation=none` process per group, so the warm cache is built N times
 * instead of once-per-file, while N groups still run in parallel.
 *
 * Measured on packages/db (2026-08-04, 217 tests, coverage off):
 *   per-file isolation, --test-concurrency=4 ... 137.5s wall / 548s CPU
 *   --test-isolation=none, single process ...... 127.7s wall / 152s CPU
 *   4 shards x --test-isolation=none ...........  74.8s wall / 240s CPU
 *
 * Sharing a process is the trade: files in the same shard share module state and
 * globals. A suite must be proven under `--test-isolation=none` before it is
 * moved onto this runner — that proof is the entry condition, not a hope.
 *
 * Usage: node ../../scripts/test-shards.mjs [--shards=N] [--node-arg=--flag] <file globs...>
 */
import { spawn } from "node:child_process";
import { globSync } from "node:fs";
import { availableParallelism } from "node:os";

const argv = process.argv.slice(2);
const patterns = [];
const nodeArgs = [];
let shardCount = 0;

for (const arg of argv) {
  if (arg.startsWith("--shards=")) shardCount = Number(arg.slice("--shards=".length));
  else if (arg.startsWith("--node-arg=")) nodeArgs.push(arg.slice("--node-arg=".length));
  else patterns.push(arg);
}

if (patterns.length === 0) {
  console.error("test-shards: no test file patterns given");
  process.exit(1);
}

// Half the cores by default: these shards are CPU-saturating (PGlite runs a real
// Postgres in WASM), and the machine routinely hosts parallel agent worktrees.
const defaultShards = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
if (!Number.isFinite(shardCount) || shardCount < 1) {
  shardCount = Number(process.env.TEST_SHARDS) || defaultShards;
}

const files = [...new Set(patterns.flatMap((pattern) => globSync(pattern)))].sort();
if (files.length === 0) {
  console.error(`test-shards: no files matched ${patterns.join(" ")}`);
  process.exit(1);
}

const groups = Array.from({ length: Math.min(shardCount, files.length) }, () => []);
// Round-robin rather than contiguous slices: neighbouring files in a sorted list
// tend to belong to the same area and have similar cost, so striping spreads the
// expensive ones across shards instead of piling them into one.
files.forEach((file, index) => groups[index % groups.length].push(file));

const startedAt = Date.now();
const shards = await Promise.all(
  groups.map(
    (group, index) =>
      new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          ["--test-isolation=none", ...nodeArgs, "--test", ...group],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        child.on("close", (code) => resolve({ index, code, output, files: group.length }));
      }),
  ),
);

let passed = 0;
let failed = 0;
for (const shard of shards) {
  passed += Number(/^ℹ pass (\d+)$/m.exec(shard.output)?.[1] ?? 0);
  failed += Number(/^ℹ fail (\d+)$/m.exec(shard.output)?.[1] ?? 0);
  // Only a failing shard prints its full log. A green run stays quiet so the
  // useful signal is not buried under four interleaved success streams.
  if (shard.code !== 0) {
    console.error(`\n===== shard ${shard.index} FAILED (exit ${shard.code}) =====`);
    console.error(shard.output);
  }
}

const wall = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `test-shards: ${files.length} files in ${groups.length} shards — ${passed} passed, ${failed} failed (${wall}s)`,
);
process.exit(shards.some((shard) => shard.code !== 0) ? 1 : 0);
