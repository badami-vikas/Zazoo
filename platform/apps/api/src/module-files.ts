import { readdir, stat } from "node:fs/promises";
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

function safePathSegment(value: string, label: string): string {
  const segment = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");
  if (!segment || segment === "." || segment === "..") {
    throw new ModuleFilesPathError(label);
  }
  return segment;
}

export function moduleFilesRoot(organizationName: string, moduleName: string): string {
  const bridgeRoot = resolve(homedir(), "Documents", "Bridge");
  const root = resolve(
    bridgeRoot,
    safePathSegment(organizationName, "Organization name"),
    safePathSegment(moduleName, "Module name"),
  );
  const descendant = relative(bridgeRoot, root);
  if (!descendant || descendant === ".." || descendant.startsWith(`..${sep}`) || isAbsolute(descendant)) {
    throw new ModuleFilesPathError("Module File root");
  }
  return root;
}

export async function listModuleFiles(
  organizationName: string,
  moduleName: string,
  limit = 200,
): Promise<{ root: string; items: ModuleFileInventoryItem[]; truncated: boolean }> {
  const root = moduleFilesRoot(organizationName, moduleName);
  const items: ModuleFileInventoryItem[] = [];
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
