import {
  lstat,
  mkdir,
  readdir,
  rename,
  rmdir,
} from "node:fs/promises";
import { join } from "node:path";

interface RegistryMove {
  sourceDirectory: string;
  source: string;
  targetDirectory: string;
  target: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Move the retired registry directory into the canonical Module registry before
 * serving reads. Rename preserves the exact signed bytes and is restart-safe:
 * completed files stay canonical and remaining source files resume on retry.
 */
export async function migrateLegacyRegistry(dataDir: string): Promise<void> {
  const sourceRoot = join(dataDir, "packages");
  const targetRoot = join(dataDir, "modules");
  let moduleEntries;
  try {
    moduleEntries = await readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  const moves: RegistryMove[] = [];
  const sourceDirectories: string[] = [];
  for (const moduleEntry of moduleEntries) {
    if (!moduleEntry.isDirectory()) {
      throw new Error(`commons: unsupported legacy registry entry ${moduleEntry.name}`);
    }
    const sourceDirectory = join(sourceRoot, moduleEntry.name);
    sourceDirectories.push(sourceDirectory);
    const targetDirectory = join(targetRoot, moduleEntry.name);
    for (const versionEntry of await readdir(sourceDirectory, { withFileTypes: true })) {
      if (!versionEntry.isFile() || !versionEntry.name.endsWith(".json")) {
        throw new Error(
          `commons: unsupported legacy module entry ${moduleEntry.name}/${versionEntry.name}`,
        );
      }
      const target = join(targetDirectory, versionEntry.name);
      if (await exists(target)) {
        throw new Error(
          `commons: conflicting registry entries for ${decodeURIComponent(moduleEntry.name)}@${decodeURIComponent(versionEntry.name.slice(0, -5))}`,
        );
      }
      moves.push({
        sourceDirectory,
        source: join(sourceDirectory, versionEntry.name),
        targetDirectory,
        target,
      });
    }
  }

  await mkdir(targetRoot, { recursive: true });
  for (const move of moves) {
    await mkdir(move.targetDirectory, { recursive: true });
    await rename(move.source, move.target);
  }
  for (const sourceDirectory of sourceDirectories) {
    await rmdir(sourceDirectory);
  }
  await rmdir(sourceRoot);
}
