import { mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

export const MAX_MODULE_FILE_BYTES = 10 * 1024 * 1024;

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

async function writableModuleFilesRoot(
  organizationName: string,
  moduleName: string,
  bridgeRootOverride?: string,
): Promise<string> {
  const bridgeRoot = resolve(bridgeRootOverride ?? join(homedir(), "Documents", "Bridge"));
  await mkdir(bridgeRoot, { recursive: true, mode: 0o700 });
  const canonicalBridgeRoot = await realpath(bridgeRoot);
  const root = resolve(
    bridgeRoot,
    safePathSegment(organizationName, "Organization name"),
    safePathSegment(moduleName, "Module name"),
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(root);
  const descendant = relative(canonicalBridgeRoot, canonicalRoot);
  if (!descendant || descendant === ".." || descendant.startsWith(`..${sep}`) || isAbsolute(descendant)) {
    throw new ModuleFilesPathError("Module File root");
  }
  return canonicalRoot;
}

function safeFileName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new ModuleFilesPathError("File name");
  }
  const name = safePathSegment(trimmed, "File name");
  if (Buffer.byteLength(name, "utf8") > 240) {
    throw new ModuleFilesPathError("File name");
  }
  return name;
}

export async function saveModuleFile(
  organizationName: string,
  moduleName: string,
  fileName: string,
  content: Uint8Array,
  bridgeRootOverride?: string,
): Promise<ModuleFileInventoryItem> {
  if (content.byteLength > MAX_MODULE_FILE_BYTES) {
    throw new RangeError(`File exceeds the ${MAX_MODULE_FILE_BYTES}-byte local File limit`);
  }
  const root = await writableModuleFilesRoot(
    organizationName,
    moduleName,
    bridgeRootOverride,
  );
  const name = safeFileName(fileName);
  const extension = extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? name : `${stem} (${attempt + 1})${extension}`;
    const destination = resolve(root, candidate);
    const descendant = relative(root, destination);
    if (!descendant || descendant === ".." || descendant.startsWith(`..${sep}`) || isAbsolute(descendant)) {
      throw new ModuleFilesPathError("File name");
    }
    try {
      await writeFile(destination, content, { flag: "wx", mode: 0o600 });
      const metadata = await stat(destination);
      return {
        path: candidate,
        size: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique local File name");
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
