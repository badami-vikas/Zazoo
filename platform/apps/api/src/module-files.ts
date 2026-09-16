import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

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

export class ModuleFileContentConflictError extends Error {
  constructor(readonly expectedHash: string | null, readonly actualHash: string | null) {
    super(`Module File content changed (${expectedHash ?? "absent"} != ${actualHash ?? "absent"})`);
    this.name = "ModuleFileContentConflictError";
  }
}

export const MAX_MODULE_FILE_BYTES = 10 * 1024 * 1024;
const organizationFileOperations = new Map<string, Promise<void>>();

export async function withOrganizationFileOperationLock<T>(
  organizationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = organizationFileOperations.get(organizationId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  organizationFileOperations.set(organizationId, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (organizationFileOperations.get(organizationId) === tail) {
      organizationFileOperations.delete(organizationId);
    }
  }
}

function contentHash(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export class OrganizationFilesConflictError extends Error {
  constructor(readonly targetPath: string) {
    super("The Organization Files directory already exists");
    this.name = "OrganizationFilesConflictError";
  }
}

export class OrganizationFilesRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationFilesRecoveryError";
  }
}

interface OrganizationRenameIntent {
  organizationId: string;
  generation: string;
  previousOrganizationName: string;
  nextOrganizationName: string;
  createdAt: string;
}

export interface OrganizationRenameLease {
  recover(currentOrganizationName: string): Promise<void>;
  rename(
    previousOrganizationName: string,
    nextOrganizationName: string,
  ): Promise<void>;
  complete(): Promise<void>;
}

interface PreparedOrganizationFilesRename {
  previousRoot: string;
  nextRoot: string;
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

/**
 * Module Files live at `~/Documents/Bridge/<Organization>/<Module display
 * name>/`, so RENAMING a Module's display name renames the folder the owner's
 * own documents sit in. Left alone, the rename would create a fresh empty
 * folder beside the old one and the files would simply stop appearing — a
 * silent loss of the user's own data, which is the worst version of the
 * "success-shaped failure" pattern the bug ledger keeps recording.
 *
 * This table carries each rename forward exactly once. Keyed by
 * `<Organization>/<previous display name>`-independent module label: previous
 * label → current label (APPROVALS 2026-08-05, ADR-178).
 */
const MODULE_FILE_ROOT_RENAMES: ReadonlyMap<string, string> = new Map([
  ["DealPilot", "DealManager"],
  ["JobPilot", "JobManager"],
  ["Relationship", "NetworkManager"],
  ["Task Manager", "TaskManager"],
]);

/**
 * Adopt a previously-named Module folder, once. Deliberately conservative: it
 * acts ONLY when the new folder does not exist and the old one does, so it can
 * never merge two directories, never overwrites, and re-running is a no-op. A
 * failure is swallowed — losing the adoption leaves the old folder untouched on
 * disk, which is recoverable; letting it throw would break Files entirely.
 */
async function adoptRenamedModuleFolder(organizationRoot: string, moduleLabel: string): Promise<void> {
  const previousLabel = [...MODULE_FILE_ROOT_RENAMES.entries()].find(
    ([, current]) => current === moduleLabel,
  )?.[0];
  if (!previousLabel) return;
  const target = resolve(organizationRoot, safePathSegment(moduleLabel, "Module name"));
  const source = resolve(organizationRoot, safePathSegment(previousLabel, "Module name"));
  try {
    if (await pathMetadata(target)) return;
    const existing = await pathMetadata(source);
    if (!existing?.isDirectory() || existing.isSymbolicLink()) return;
    await rename(source, target);
  } catch {
    // Non-fatal by design — see the doc comment above.
  }
}

async function writableModuleFilesRoot(
  organizationName: string,
  moduleName: string,
  bridgeRootOverride?: string,
): Promise<string> {
  const bridgeRoot = resolve(bridgeRootOverride ?? join(homedir(), "Documents", "Bridge"));
  await mkdir(bridgeRoot, { recursive: true, mode: 0o700 });
  const canonicalBridgeRoot = await realpath(bridgeRoot);
  const organizationRoot = resolve(bridgeRoot, safePathSegment(organizationName, "Organization name"));
  const root = resolve(organizationRoot, safePathSegment(moduleName, "Module name"));
  await mkdir(organizationRoot, { recursive: true, mode: 0o700 });
  await adoptRenamedModuleFolder(organizationRoot, moduleName);
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

export interface ModuleFileContent {
  content: Uint8Array;
  contentHash: string;
  item: ModuleFileInventoryItem;
}

export async function readModuleFileContent(
  organizationName: string,
  moduleName: string,
  fileName: string,
  bridgeRootOverride?: string,
): Promise<ModuleFileContent | null> {
  const root = await writableModuleFilesRoot(organizationName, moduleName, bridgeRootOverride);
  const name = safeFileName(fileName);
  const path = resolve(root, name);
  const metadata = await pathMetadata(path);
  if (!metadata) return null;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new ModuleFilesPathError("Module File");
  }
  const content = await readFile(path);
  return {
    content,
    contentHash: contentHash(content),
    item: { path: name, size: metadata.size, modifiedAt: metadata.mtime.toISOString() },
  };
}

export async function replaceModuleFileContent(
  organizationName: string,
  moduleName: string,
  fileName: string,
  expectedHash: string | null,
  content: Uint8Array,
  bridgeRootOverride?: string,
): Promise<ModuleFileContent> {
  if (content.byteLength > MAX_MODULE_FILE_BYTES) {
    throw new RangeError(`File exceeds the ${MAX_MODULE_FILE_BYTES}-byte local File limit`);
  }
  const root = await writableModuleFilesRoot(organizationName, moduleName, bridgeRootOverride);
  const name = safeFileName(fileName);
  const destination = resolve(root, name);
  const lockPath = resolve(root, `.${name}.bridge-lock`);
  const temporary = resolve(root, `.${name}.${randomUUID()}.tmp`);
  const previous = resolve(root, `.${name}.${randomUUID()}.previous`);
  let lock;
  let movedPrevious = false;
  try {
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ModuleFileContentConflictError(expectedHash, null);
      }
      throw error;
    }
    const existing = await readModuleFileContent(
      organizationName,
      moduleName,
      name,
      bridgeRootOverride,
    );
    const actualHash = existing?.contentHash ?? null;
    if (actualHash !== expectedHash) {
      throw new ModuleFileContentConflictError(expectedHash, actualHash);
    }
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    if (existing) {
      await rename(destination, previous);
      movedPrevious = true;
      const previousMetadata = await lstat(previous);
      if (previousMetadata.isSymbolicLink() || !previousMetadata.isFile()) {
        await rename(previous, destination);
        movedPrevious = false;
        throw new ModuleFilesPathError("Module File");
      }
      const movedHash = contentHash(await readFile(previous));
      if (movedHash !== expectedHash) {
        await rename(previous, destination);
        movedPrevious = false;
        throw new ModuleFileContentConflictError(expectedHash, movedHash);
      }
    }
    try {
      await link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ModuleFileContentConflictError(expectedHash, null);
      }
      throw error;
    }
    if (movedPrevious) {
      const finalPreviousHash = contentHash(await readFile(previous));
      if (finalPreviousHash !== expectedHash) {
        const installedHash = contentHash(await readFile(destination));
        if (installedHash === contentHash(content)) {
          await rm(destination, { force: true });
          await rename(previous, destination);
          movedPrevious = false;
        }
        throw new ModuleFileContentConflictError(expectedHash, finalPreviousHash);
      }
      await rm(previous, { force: true });
      movedPrevious = false;
    }
  } finally {
    await rm(temporary, { force: true });
    if (movedPrevious && !(await pathMetadata(destination))) {
      await rename(previous, destination);
      movedPrevious = false;
    }
    await rm(previous, { force: true });
    await lock?.close();
    await rm(lockPath, { force: true });
  }
  const metadata = await stat(destination);
  return {
    content,
    contentHash: contentHash(content),
    item: { path: name, size: metadata.size, modifiedAt: metadata.mtime.toISOString() },
  };
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

/**
 * Move a Module's Files folder when its Organization renames the Module
 * (TASK-081). Same conservative shape as `adoptRenamedModuleFolder` above and
 * for the same reason, with one addition: it reports whether it moved, because
 * the caller writes a durable override and should be able to say what happened
 * to the folder.
 *
 * It acts ONLY when the source is a real directory and the destination does
 * not exist. So it never merges two directories, never overwrites, and is a
 * no-op on re-run. Every other case returns a reason instead of throwing:
 * a rename whose folder cannot follow must still rename the Module — refusing
 * the rename because a directory is in the way would be the tail wagging the
 * dog, and the label is recoverable while a merged directory is not.
 */
export type ModuleFolderRenameOutcome =
  | "moved"
  | "nothing-to-move"
  | "destination-exists"
  | "same-label";

export async function renameModuleFolder(
  organizationName: string,
  previousLabel: string,
  nextLabel: string,
  bridgeRoot = defaultBridgeFilesRoot(),
): Promise<ModuleFolderRenameOutcome> {
  const organizationRoot = organizationFilesRoot(organizationName, bridgeRoot);
  const source = resolve(organizationRoot, safePathSegment(previousLabel, "Module name"));
  const target = resolve(organizationRoot, safePathSegment(nextLabel, "Module name"));
  if (source === target) return "same-label";
  assertDescendant(organizationRoot, source, "Module File root");
  assertDescendant(organizationRoot, target, "Module File root");
  if (await pathMetadata(target)) return "destination-exists";
  const existing = await pathMetadata(source);
  if (!existing?.isDirectory() || existing.isSymbolicLink()) return "nothing-to-move";
  await rename(source, target);
  return "moved";
}

async function pathMetadata(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readOrganizationRenameIntent(
  intentPath: string,
  organizationId: string,
): Promise<OrganizationRenameIntent | null> {
  const metadata = await pathMetadata(intentPath);
  if (!metadata) return null;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new OrganizationFilesRecoveryError("Organization Files rename intent is not a regular file");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(intentPath, "utf8"));
  } catch {
    throw new OrganizationFilesRecoveryError("Organization Files rename intent is invalid");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).organizationId !== organizationId ||
    typeof (parsed as Record<string, unknown>).generation !== "string" ||
    typeof (parsed as Record<string, unknown>).previousOrganizationName !== "string" ||
    typeof (parsed as Record<string, unknown>).nextOrganizationName !== "string" ||
    typeof (parsed as Record<string, unknown>).createdAt !== "string"
  ) {
    throw new OrganizationFilesRecoveryError("Organization Files rename intent does not match this Organization");
  }
  return parsed as OrganizationRenameIntent;
}

async function writeOrganizationRenameIntent(
  intentPath: string,
  temporaryPath: string,
  intent: OrganizationRenameIntent,
): Promise<void> {
  if (await pathMetadata(intentPath)) {
    throw new OrganizationFilesRecoveryError("A previous Organization Files rename must be recovered first");
  }
  const temporary = await open(temporaryPath, "wx", 0o600);
  try {
    await temporary.writeFile(JSON.stringify(intent));
    await temporary.sync();
  } finally {
    await temporary.close();
  }
  await rename(temporaryPath, intentPath);
  await syncDirectory(dirname(intentPath));
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const directory = await open(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform === "win32" &&
      (code === "EINVAL" || code === "EISDIR" || code === "EPERM")
    ) {
      return;
    }
    throw error;
  }
}

async function clearOrganizationRenameIntent(
  intentPath: string,
  organizationId: string,
  generation: string,
): Promise<void> {
  const intent = await readOrganizationRenameIntent(intentPath, organizationId);
  if (intent?.generation === generation) {
    await rm(intentPath, { force: true });
  }
}

async function assertSafeExistingOrganizationRoot(
  root: string,
  metadata: Awaited<ReturnType<typeof lstat>>,
  bridgeRoot: string,
): Promise<void> {
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new ModuleFilesPathError("Organization File root");
  }
  assertDescendant(
    await realpath(resolve(bridgeRoot)),
    await realpath(root),
    "Organization File root",
  );
}

async function sameFilesystemEntry(
  firstPath: string,
  first: Awaited<ReturnType<typeof lstat>>,
  secondPath: string,
  second: Awaited<ReturnType<typeof lstat>>,
): Promise<boolean> {
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    await realpath(firstPath) === await realpath(secondPath)
  );
}

async function recoverOrganizationRenameIntent(
  intentPath: string,
  organizationId: string,
  currentOrganizationName: string,
  bridgeRoot: string,
): Promise<void> {
  const intent = await readOrganizationRenameIntent(intentPath, organizationId);
  if (!intent) return;
  const previousRoot = organizationFilesRoot(intent.previousOrganizationName, bridgeRoot);
  const nextRoot = organizationFilesRoot(intent.nextOrganizationName, bridgeRoot);
  const currentRoot = organizationFilesRoot(currentOrganizationName, bridgeRoot);
  if (previousRoot === nextRoot) {
    throw new OrganizationFilesRecoveryError("Organization Files rename intent has identical roots");
  }
  if (currentRoot !== previousRoot && currentRoot !== nextRoot) {
    throw new OrganizationFilesRecoveryError(
      "Organization name no longer matches the pending Files rename",
    );
  }
  const [previousMetadata, nextMetadata] = await Promise.all([
    pathMetadata(previousRoot),
    pathMetadata(nextRoot),
  ]);
  if (previousMetadata) {
    await assertSafeExistingOrganizationRoot(previousRoot, previousMetadata, bridgeRoot);
  }
  if (nextMetadata) {
    await assertSafeExistingOrganizationRoot(nextRoot, nextMetadata, bridgeRoot);
  }
  if (previousMetadata && nextMetadata) {
    if (
      await sameFilesystemEntry(
        previousRoot,
        previousMetadata,
        nextRoot,
        nextMetadata,
      )
    ) {
      const actualRoot = await realpath(currentRoot);
      if (basename(actualRoot) !== basename(currentRoot)) {
        await rename(actualRoot, currentRoot);
        await syncDirectory(resolve(bridgeRoot));
      }
      await rm(intentPath, { force: true });
      return;
    }
    throw new OrganizationFilesRecoveryError(
      "Both Organization Files roots exist; preserving the rename intent for explicit recovery",
    );
  }
  let moved = false;
  if (currentRoot === previousRoot && nextMetadata) {
    await rename(nextRoot, previousRoot);
    moved = true;
  } else if (currentRoot === nextRoot && previousMetadata) {
    await rename(previousRoot, nextRoot);
    moved = true;
  }
  if (moved) await syncDirectory(resolve(bridgeRoot));
  await rm(intentPath, { force: true });
}

export async function createOrganizationRenameLease(
  organizationId: string,
  bridgeRoot: string,
): Promise<OrganizationRenameLease> {
  const resolvedBridgeRoot = resolve(bridgeRoot);
  const existingBridgeRoot = await pathMetadata(resolvedBridgeRoot);
  if (existingBridgeRoot?.isSymbolicLink() || (existingBridgeRoot && !existingBridgeRoot.isDirectory())) {
    throw new ModuleFilesPathError("Bridge File root");
  }
  await mkdir(resolvedBridgeRoot, { recursive: true });
  const locksRoot = join(resolvedBridgeRoot, ".locks");
  const existingLocksRoot = await pathMetadata(locksRoot);
  await mkdir(locksRoot, { recursive: true });
  const locksMetadata = await pathMetadata(locksRoot);
  if (!locksMetadata || locksMetadata.isSymbolicLink() || !locksMetadata.isDirectory()) {
    throw new ModuleFilesPathError("Bridge File lock root");
  }
  if (!existingLocksRoot) await syncDirectory(resolvedBridgeRoot);
  const intentPath = join(
    locksRoot,
    `organization-${safePathSegment(organizationId, "Organization id")}.intent.json`,
  );
  const generation = randomUUID();
  const temporaryPath = `${intentPath}.${generation}.tmp`;
  return {
    recover: (currentOrganizationName) =>
      withOrganizationFileOperationLock(
        organizationId,
        () => recoverOrganizationRenameIntent(
          intentPath,
          organizationId,
          currentOrganizationName,
          resolvedBridgeRoot,
        ),
      ),
    rename: (previousOrganizationName, nextOrganizationName) =>
      withOrganizationFileOperationLock(organizationId, async () => {
      const previousRoot = organizationFilesRoot(previousOrganizationName, resolvedBridgeRoot);
      const nextRoot = organizationFilesRoot(nextOrganizationName, resolvedBridgeRoot);
      if (previousRoot === nextRoot) return;
      const prepared = await prepareOrganizationFilesRename(
        previousOrganizationName,
        nextOrganizationName,
        resolvedBridgeRoot,
      );
      if (!prepared) return;
      await writeOrganizationRenameIntent(
        intentPath,
        temporaryPath,
        {
          organizationId,
          generation,
          previousOrganizationName,
          nextOrganizationName,
          createdAt: new Date().toISOString(),
        },
      );
      let moved = false;
      try {
        const confirmed = await prepareOrganizationFilesRename(
          previousOrganizationName,
          nextOrganizationName,
          resolvedBridgeRoot,
        );
        if (!confirmed) {
          throw new OrganizationFilesRecoveryError(
            "Organization Files source changed before rename",
          );
        }
        await rename(confirmed.previousRoot, confirmed.nextRoot);
        moved = true;
        await syncDirectory(resolvedBridgeRoot);
      } catch (error) {
        if (!moved) {
          await clearOrganizationRenameIntent(intentPath, organizationId, generation);
        }
        throw error;
      }
      }),
    complete: () => withOrganizationFileOperationLock(
      organizationId,
      () => clearOrganizationRenameIntent(intentPath, organizationId, generation),
    ),
  };
}

async function prepareOrganizationFilesRename(
  previousOrganizationName: string,
  nextOrganizationName: string,
  bridgeRoot = defaultBridgeFilesRoot(),
): Promise<PreparedOrganizationFilesRename | null> {
  const previousRoot = organizationFilesRoot(previousOrganizationName, bridgeRoot);
  const nextRoot = organizationFilesRoot(nextOrganizationName, bridgeRoot);
  if (previousRoot === nextRoot) return null;
  const bridgeMetadata = await pathMetadata(resolve(bridgeRoot));
  if (bridgeMetadata?.isSymbolicLink() || (bridgeMetadata && !bridgeMetadata.isDirectory())) {
    throw new ModuleFilesPathError("Bridge File root");
  }
  const [previousMetadata, nextMetadata] = await Promise.all([
    pathMetadata(previousRoot),
    pathMetadata(nextRoot),
  ]);
  if (nextMetadata) {
    if (
      nextMetadata.isSymbolicLink() ||
      !nextMetadata.isDirectory() ||
      !previousMetadata ||
      !(await sameFilesystemEntry(
        previousRoot,
        previousMetadata,
        nextRoot,
        nextMetadata,
      ))
    ) {
      throw new OrganizationFilesConflictError(nextRoot);
    }
  }
  if (!previousMetadata) return null;
  if (previousMetadata.isSymbolicLink() || !previousMetadata.isDirectory()) {
    throw new ModuleFilesPathError("Organization File root");
  }
  if (bridgeMetadata) {
    assertDescendant(
      await realpath(resolve(bridgeRoot)),
      await realpath(previousRoot),
      "Organization File root",
    );
  }
  return { previousRoot, nextRoot };
}

export async function listModuleFiles(
  organizationName: string,
  moduleName: string,
  limit = 200,
  bridgeRoot = defaultBridgeFilesRoot(),
): Promise<{ root: string; items: ModuleFileInventoryItem[]; truncated: boolean }> {
  const root = moduleFilesRoot(organizationName, moduleName, bridgeRoot);
  const items: ModuleFileInventoryItem[] = [];
  const resolvedBridgeRoot = resolve(bridgeRoot);
  const organizationRoot = organizationFilesRoot(organizationName, bridgeRoot);
  const bridgeMetadata = await pathMetadata(resolvedBridgeRoot);
  if (!bridgeMetadata) return { root, items, truncated: false };
  if (bridgeMetadata.isSymbolicLink() || !bridgeMetadata.isDirectory()) {
    throw new ModuleFilesPathError("Bridge File root");
  }
  const organizationMetadata = await pathMetadata(organizationRoot);
  if (!organizationMetadata) return { root, items, truncated: false };
  if (organizationMetadata.isSymbolicLink() || !organizationMetadata.isDirectory()) {
    throw new ModuleFilesPathError("Organization File root");
  }
  // Listing is usually the FIRST thing that touches a Module's folder after a
  // rename, so the adoption has to run here too — otherwise the Files Section
  // renders empty and the owner concludes their documents are gone.
  await adoptRenamedModuleFolder(organizationRoot, moduleName);
  const rootMetadata = await pathMetadata(root);
  if (!rootMetadata) return { root, items, truncated: false };
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new ModuleFilesPathError("Module File root");
  }
  assertDescendant(
    await realpath(resolvedBridgeRoot),
    await realpath(root),
    "Module File root",
  );
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
