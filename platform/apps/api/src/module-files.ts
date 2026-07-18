import { lstat, readdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface ModuleFileInventoryItem {
  path: string;
  size: number;
  modifiedAt: string;
}

export class ModuleFilesPathError extends Error {
  constructor(label: string) {
    super(`${label} cannot address a path outside the Bridge File root`);
    this.name = "ModuleFilesPathError";
  }
}

export class OrganizationFilesConflictError extends Error {
  constructor(readonly targetPath: string) {
    super("The Organization Files directory already exists");
    this.name = "OrganizationFilesConflictError";
  }
}

function safePathSegment(value: string, label: string): string {
  const segment = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");
  if (!segment || segment === "." || segment === "..") {
    throw new ModuleFilesPathError(label);
  }
  return segment;
}

function assertDescendant(root: string, candidate: string, label: string): void {
  const descendant = relative(root, candidate);
  if (!descendant || descendant === ".." || descendant.startsWith(`..${sep}`) || isAbsolute(descendant)) {
    throw new ModuleFilesPathError(label);
  }
}

export function defaultBridgeFilesRoot(): string {
  return resolve(homedir(), "Documents", "Bridge");
}

export function organizationFilesRoot(
  organizationName: string,
  bridgeRoot = defaultBridgeFilesRoot(),
): string {
  const resolvedBridgeRoot = resolve(bridgeRoot);
  const root = resolve(resolvedBridgeRoot, safePathSegment(organizationName, "Organization name"));
  assertDescendant(resolvedBridgeRoot, root, "Organization File root");
  return root;
}

export function moduleFilesRoot(
  organizationName: string,
  moduleName: string,
  bridgeRoot = defaultBridgeFilesRoot(),
): string {
  const organizationRoot = organizationFilesRoot(organizationName, bridgeRoot);
  const root = resolve(organizationRoot, safePathSegment(moduleName, "Module name"));
  assertDescendant(organizationRoot, root, "Module File root");
  return root;
}

async function pathMetadata(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function renameOrganizationFilesRoot(
  previousOrganizationName: string,
  nextOrganizationName: string,
  bridgeRoot = defaultBridgeFilesRoot(),
): Promise<(() => Promise<void>) | undefined> {
  const previousRoot = organizationFilesRoot(previousOrganizationName, bridgeRoot);
  const nextRoot = organizationFilesRoot(nextOrganizationName, bridgeRoot);
  if (previousRoot === nextRoot) return undefined;
  if (await pathMetadata(nextRoot)) throw new OrganizationFilesConflictError(nextRoot);
  const previousMetadata = await pathMetadata(previousRoot);
  if (!previousMetadata) return undefined;
  if (previousMetadata.isSymbolicLink() || !previousMetadata.isDirectory()) {
    throw new ModuleFilesPathError("Organization File root");
  }

  await rename(previousRoot, nextRoot);
  return async () => {
    if (await pathMetadata(previousRoot)) {
      throw new OrganizationFilesConflictError(previousRoot);
    }
    const nextMetadata = await pathMetadata(nextRoot);
    if (!nextMetadata) return;
    if (nextMetadata.isSymbolicLink() || !nextMetadata.isDirectory()) {
      throw new ModuleFilesPathError("Organization File root");
    }
    await rename(nextRoot, previousRoot);
  };
}

export async function listModuleFiles(
  organizationName: string,
  moduleName: string,
  limit = 200,
  bridgeRoot = defaultBridgeFilesRoot(),
): Promise<{ root: string; items: ModuleFileInventoryItem[]; truncated: boolean }> {
  const root = moduleFilesRoot(organizationName, moduleName, bridgeRoot);
  const items: ModuleFileInventoryItem[] = [];
  const rootMetadata = await pathMetadata(root);
  if (!rootMetadata) return { root, items, truncated: false };
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new ModuleFilesPathError("Module File root");
  }
  let rootEntries;
  try {
    rootEntries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { root, items, truncated: false };
    throw error;
  }

  const visit = async (directory: string, entries: typeof rootEntries): Promise<boolean> => {
    for (const entry of entries) {
      if (items.length >= limit) return true;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const truncated = await visit(absolute, await readdir(absolute, { withFileTypes: true }));
        if (truncated) return true;
        continue;
      }
      if (!entry.isFile()) continue;
      const metadata = await stat(absolute);
      items.push({
        path: relative(root, absolute),
        size: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
      });
    }
    return false;
  };

  const truncated = await visit(root, rootEntries);
  items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return { root, items, truncated };
}
