/**
 * CommonsStore — the storage port behind the Commons HTTP surface, mirroring
 * @bridge/core's PackageStore/CapabilityStore port discipline: routes bind
 * against THIS interface, never a concrete store, so the Bridge Cloud
 * deployment swaps Postgres in without touching the contract.
 *
 * v1 implementation = local filesystem JSON (deliberately simple, zero new
 * DB dependency): one file per published (name, version) under
 * `<dataDir>/packages/<name>/<version>.json`. Names/versions are validated
 * upstream by parsePackageManifest (kebab-case / strict semver), which also
 * makes them path-safe; encodeURIComponent is belt-and-braces.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommonsPackageEntry } from "@bridge/core";

export interface CommonsStore {
  /** Persist one published entry. Rejects on duplicate (name, version) —
   * published versions are immutable (same rule the package lifecycle's
   * single-live-version model assumes). */
  put(entry: CommonsPackageEntry): Promise<void>;
  /** One exact version, or null. */
  get(name: string, version: string): Promise<CommonsPackageEntry | null>;
  /** All versions of one package, oldest-first by publishedAt. Empty when unknown. */
  listVersions(name: string): Promise<CommonsPackageEntry[]>;
  /** Every published entry (all packages, all versions). */
  listAll(): Promise<CommonsPackageEntry[]>;
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

  constructor(dataDir: string) {
    this.#root = join(dataDir, "packages");
  }

  #versionPath(name: string, version: string): string {
    return join(this.#root, safeSegment(name), `${safeSegment(version)}.json`);
  }

  async put(entry: CommonsPackageEntry): Promise<void> {
    const dir = join(this.#root, safeSegment(entry.name));
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(
        this.#versionPath(entry.name, entry.version),
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

  async get(name: string, version: string): Promise<CommonsPackageEntry | null> {
    try {
      const raw = await readFile(this.#versionPath(name, version), "utf8");
      return JSON.parse(raw) as CommonsPackageEntry;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async listVersions(name: string): Promise<CommonsPackageEntry[]> {
    let files: string[];
    try {
      files = await readdir(join(this.#root, safeSegment(name)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const entries: CommonsPackageEntry[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const version = decodeURIComponent(file.slice(0, -".json".length));
      const entry = await this.get(name, version);
      if (entry !== null) entries.push(entry);
    }
    return entries.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  }

  async listAll(): Promise<CommonsPackageEntry[]> {
    let dirs: string[];
    try {
      dirs = await readdir(this.#root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const all: CommonsPackageEntry[] = [];
    for (const dir of dirs) {
      all.push(...(await this.listVersions(decodeURIComponent(dir))));
    }
    return all;
  }
}
