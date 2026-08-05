/**
 * The Files Section's navigation model (ADR-195) — pure, no React, no tRPC.
 *
 * `modules.files` returns a FLAT list of file paths relative to the Module root,
 * with no directory entries at all. Every folder the explorer renders is
 * inferred from the separators in those paths, so this derivation IS the
 * navigation model — which is exactly why it lives here rather than inside the
 * component: it is the part worth testing, and a `.tsx` cannot be loaded by the
 * node test runner.
 */

/** The server's per-File shape (`ModuleFileInventoryItem`), structurally. */
export interface FileInventoryItem {
  path: string;
  size: number;
  modifiedAt: string;
}

/** One row in the current folder — either a real File or a derived folder. */
export interface FileEntry {
  name: string;
  /** Path relative to the Module root. Folders included; "" is the root. */
  path: string;
  isDirectory: boolean;
  /** Bytes; for a folder, the sum of everything beneath it. */
  size: number;
  /** A File's own mtime; for a folder, the newest beneath it. */
  modifiedAt: string;
  /** Files at any depth inside a folder. Undefined for a File. */
  childCount?: number;
}

export type FileSortKey = "name" | "size" | "modifiedAt";
export type FileSortDir = "asc" | "desc";

/**
 * The immediate children of `folder`.
 *
 * Splitting on the FIRST separator after the folder's prefix is what keeps a
 * grandchild out of the parent's listing, and what stops a folder named `test`
 * from absorbing `test2` — the separator decides, not the string prefix.
 *
 * A folder's size and timestamp aggregate everything beneath it, so the Size and
 * Date columns say something true on a folder row instead of sitting blank.
 */
export function entriesForFolder(items: FileInventoryItem[], folder: string): FileEntry[] {
  const prefix = folder === "" ? "" : `${folder}/`;
  const files: FileEntry[] = [];
  const folders = new Map<string, FileEntry>();

  for (const item of items) {
    if (!item.path.startsWith(prefix)) continue;
    const rest = item.path.slice(prefix.length);
    if (rest === "") continue;
    const separator = rest.indexOf("/");

    if (separator === -1) {
      files.push({
        name: rest,
        path: item.path,
        isDirectory: false,
        size: item.size,
        modifiedAt: item.modifiedAt,
      });
      continue;
    }

    const name = rest.slice(0, separator);
    const path = `${prefix}${name}`;
    const existing = folders.get(path);
    if (existing) {
      existing.size += item.size;
      existing.childCount = (existing.childCount ?? 0) + 1;
      if (item.modifiedAt > existing.modifiedAt) existing.modifiedAt = item.modifiedAt;
    } else {
      folders.set(path, {
        name,
        path,
        isDirectory: true,
        size: item.size,
        modifiedAt: item.modifiedAt,
        childCount: 1,
      });
    }
  }

  return [...folders.values(), ...files];
}

/**
 * Sort a folder's entries.
 *
 * Folders always precede Files whatever the column — sorting by size must not
 * drop a folder between two Files, which is the behaviour every file manager
 * has and a naive comparator does not. Returns a new array.
 */
export function sortEntries(
  entries: FileEntry[],
  key: FileSortKey,
  dir: FileSortDir,
): FileEntry[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    if (key === "name") {
      // Numeric + case-insensitive: raw codepoint order puts every capital
      // before every lowercase, and "file10" before "File2".
      return (
        factor * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      );
    }
    if (key === "size") return factor * (a.size - b.size);
    return factor * a.modifiedAt.localeCompare(b.modifiedAt);
  });
}

/** Explorer-style size: one decimal only where it carries meaning. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}
