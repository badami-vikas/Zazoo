/**
 * CommonsStore — the storage port behind the Commons HTTP surface, mirroring
 * @bridge/core's ModuleStore/CapabilityStore port discipline: routes bind
 * against THIS interface, never a concrete store, so the Bridge Cloud
 * deployment swaps Postgres in without touching the contract.
 *
 * v1 implementation = local filesystem JSON (deliberately simple, zero new
 * DB dependency): one file per published (name, version) under
 * `<dataDir>/modules/<name>/<version>.json`. Names/versions are validated
 * upstream by parseModuleManifest (kebab-case / strict semver), which also
 * makes them path-safe; encodeURIComponent is belt-and-braces.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommonsModuleEntry } from "@bridge/core";
import { decodeStoredCommonsEntry, priorRegistryRoot } from "./vocab3-registry-compat.js";

export interface CommonsStore {
  /** Persist one published entry. Rejects on duplicate (name, version) —
   * published versions are immutable (same rule the module lifecycle's
   * single-live-version model assumes). */
  put(entry: CommonsModuleEntry): Promise<void>;
  /** One exact version, or null. */
  get(name: string, version: string): Promise<CommonsModuleEntry | null>;
  /** All versions of one module, oldest-first by publishedAt. Empty when unknown. */
  listVersions(name: string): Promise<CommonsModuleEntry[]>;
  /** Every published entry (all modules, all versions). */
  listAll(): Promise<CommonsModuleEntry[]>;
}

export class DuplicateVersionError extends Error {
  constructor(name: string, version: string) {
    super(`commons: ${name}@${version} is already published — versions are immutable, publish a new version instead`);
    this.name = "DuplicateVersionError";
  }
}

function safeSegment(s: string): string {
  return encodeURIComponent(s);
}

/** Local-filesystem CommonsStore — the v1 local-first backing store. */
export class FsCommonsStore implements CommonsStore {
  readonly #root: string;
  readonly #priorRoot: string;

  constructor(dataDir: string) {
    this.#root = join(dataDir, "modules");
    this.#priorRoot = priorRegistryRoot(dataDir);
  }

  #versionPath(root: string, name: string, version: string): string {
    return join(root, safeSegment(name), `${safeSegment(version)}.json`);
  }

  async #read(root: string, name: string, version: string): Promise<CommonsModuleEntry | null> {
    try {
      return decodeStoredCommonsEntry(
        await readFile(this.#versionPath(root, name, version), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async put(entry: CommonsModuleEntry): Promise<void> {
    if (await this.get(entry.name, entry.version)) {
      throw new DuplicateVersionError(entry.name, entry.version);
    }
    const dir = join(this.#root, safeSegment(entry.name));
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(
        this.#versionPath(this.#root, entry.name, entry.version),
        JSON.stringify(entry, null, 2),
        { encoding: "utf8", flag: "wx" },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new DuplicateVersionError(entry.name, entry.version);
      }
      throw error;
    }
  }

  async get(name: string, version: string): Promise<CommonsModuleEntry | null> {
    const [current, prior] = await Promise.all([
      this.#read(this.#root, name, version),
      this.#read(this.#priorRoot, name, version),
    ]);
    if (current && prior) {
      throw new Error(`commons: conflicting registry entries for ${name}@${version}`);
    }
    return current ?? prior;
  }

  async listVersions(name: string): Promise<CommonsModuleEntry[]> {
    const files = new Set<string>();
    for (const root of [this.#root, this.#priorRoot]) {
      try {
        for (const file of await readdir(join(root, safeSegment(name)))) files.add(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const entries: CommonsModuleEntry[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const version = decodeURIComponent(file.slice(0, -".json".length));
      const entry = await this.get(name, version);
      if (entry !== null) entries.push(entry);
    }
    return entries.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  }

  async listAll(): Promise<CommonsModuleEntry[]> {
    const dirs = new Set<string>();
    for (const root of [this.#root, this.#priorRoot]) {
      try {
        for (const dir of await readdir(root)) dirs.add(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const all: CommonsModuleEntry[] = [];
    for (const dir of dirs) {
      all.push(...(await this.listVersions(decodeURIComponent(dir))));
    }
    return all;
  }
}
