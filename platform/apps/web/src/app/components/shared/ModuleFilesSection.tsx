/**
 * ModuleFilesSection — the Files Section, as an actual file explorer (ADR-195).
 *
 * WHAT THIS WAS. A flat `<ul>` of full relative paths (`sub/dir/name.txt`) with
 * a size and a timestamp underneath each. Folders were not entities: a nested
 * File appeared as its whole path in one line, there was no way to navigate,
 * sort, search, or change how the list was drawn, and the only interaction in
 * the whole section was Add local File.
 *
 * WHAT IT IS NOW. A Finder/Explorer-shaped view over the same inventory:
 * breadcrumb navigation into real folders, an Icons view and a Details view
 * with sortable Name / Size / Date-modified columns, filter-as-you-type, and
 * selection. No backend change was needed — `modules.files` already returns
 * `size` and `modifiedAt` per item; the folder tree is derived from the path
 * separators the server already sends.
 *
 * THE EMPTY STATE STAYS TEXT, DELIBERATELY. `docs/raw/ui-architecture-rules-2026-07.md`
 * §6a specifies for a Files Section with nothing in it: one line naming what
 * WOULD appear here, and explicitly "no folder icon grid". So the icon grid is
 * the POPULATED view only — an empty folder is a sentence, never a tile field.
 *
 * KNOWN LIMIT, NOT HIDDEN: `listModuleFiles` walks the tree and returns FILES
 * only, so a folder containing no files anywhere beneath it does not exist in
 * the inventory and cannot be shown. Every folder rendered here is inferred
 * from the path of a File inside it. Making empty folders visible needs the
 * server to return directory entries, which is a separate change — the graph
 * indexer consumes `items` and must not start indexing directories as Files.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Check,
  ChevronRight,
  File as FileIcon,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Filter,
  Folder,
  LayoutGrid,
  List as ListIcon,
  MoreVertical,
  Search,
  Upload,
} from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../../lib/trpc";
import {
  entriesForFolder,
  formatBytes,
  sortEntries,
  type FileEntry,
  type FileSortDir,
  type FileSortKey,
} from "./file-explorer-model.js";

type FileInventory = Awaited<ReturnType<typeof trpc.modules.files.query>>;

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Row geometry, in pixels for the same reason ADR-194 gives: `html` is set to
 * 17px, so every rem-based Tailwind unit renders 6.25% larger than it reads. */
const ROW_HEIGHT = 32;
const CELL_PAD_X = 12;
/** Body height held at zero Files so the section keeps its shape (user
 *  directive 2026-08-10: retain the visual aesthetics even when empty). */
const EMPTY_BODY_MIN_HEIGHT = 96;

type ViewMode = "icons" | "details";

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("The local File could not be read."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The local File could not be encoded."));
        return;
      }
      const separator = reader.result.indexOf(",");
      resolve(separator >= 0 ? reader.result.slice(separator + 1) : reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const EXTENSION_ICONS: Array<[RegExp, typeof FileIcon]> = [
  [/\.(png|jpe?g|gif|webp|svg|bmp|heic|avif)$/i, FileImage],
  [/\.(csv|tsv|xlsx?|numbers)$/i, FileSpreadsheet],
  [/\.(ts|tsx|js|jsx|json|rs|py|go|sh|html|css|ya?ml|toml)$/i, FileCode],
  [/\.(txt|md|rtf|pdf|docx?|pages)$/i, FileText],
];

function iconFor(entry: FileEntry): typeof FileIcon {
  if (entry.isDirectory) return Folder;
  for (const [pattern, icon] of EXTENSION_ICONS) {
    if (pattern.test(entry.name)) return icon;
  }
  return FileIcon;
}

export function ModuleFilesSection({ moduleName }: { moduleName: string }) {
  const [inventory, setInventory] = useState<FileInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const [folder, setFolder] = useState("");
  const [view, setView] = useState<ViewMode>("icons");
  const [sortKey, setSortKey] = useState<FileSortKey>("name");
  const [sortDir, setSortDir] = useState<FileSortDir>("asc");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void trpc.modules.files
      .query({ organizationId: PILOT_ORGANIZATION, moduleName })
      .then((next) => {
        if (active) setInventory(next);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [moduleName, refresh]);

  // A folder that no longer exists after a refresh would strand the view in a
  // location with nothing in it and no way back except the breadcrumb.
  useEffect(() => {
    if (!inventory || folder === "") return;
    const stillThere = inventory.items.some((item) => item.path.startsWith(`${folder}/`));
    if (!stillThere) setFolder("");
  }, [inventory, folder]);

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (chosen.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of chosen) {
        if (file.size > MAX_FILE_BYTES) {
          throw new Error(`${file.name} exceeds the 10 MB local File limit.`);
        }
        await trpc.modules.addFile.mutate({
          organizationId: PILOT_ORGANIZATION,
          moduleName,
          fileName: file.name,
          contentBase64: await fileBase64(file),
        });
      }
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setUploading(false);
    }
  }

  const entries = useMemo(() => {
    if (!inventory) return [];
    const all = entriesForFolder(inventory.items, folder);
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? all.filter((entry) => entry.name.toLowerCase().includes(needle))
      : all;
    return sortEntries(filtered, sortKey, sortDir);
  }, [inventory, folder, query, sortKey, sortDir]);

  const crumbs = folder === "" ? [] : folder.split("/");

  function openEntry(entry: FileEntry) {
    if (entry.isDirectory) {
      setFolder(entry.path);
      setSelected(null);
      setQuery("");
    }
  }

  function toggleSort(key: FileSortKey) {
    if (sortKey === key) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      // Name reads best A→Z; size and date read best newest/largest first.
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  return (
    <section className="space-y-3" aria-labelledby={`${moduleName}-files-title`}>
      <h2 id={`${moduleName}-files-title`} className="sr-only">
        Artefacts
      </h2>

      {loading ? (
        <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
          Loading local File inventory…
        </p>
      ) : error ? (
        /Local Plane|public cloud/i.test(error) ? (
          <div
            className="rounded-lg border border-dashed p-4 text-xs"
            style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
          >
            <p>Local Files live on the Bridge desktop app and are not served by the public cloud.</p>
          </div>
        ) : (
          <p role="alert" className="break-words text-xs text-red-600">
            {error}
          </p>
        )
      ) : (
        <div
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: "var(--color-border)", background: "var(--color-background)" }}
        >
          {/* Single toolbar row (user directive 2026-08-10): breadcrumb reads
              "Artefacts" in place of the old "Files" heading + module name,
              with Search, a disabled-with-reason Filter (AP-021 — Files has
              only a name dimension today, no type/date filter is wired), the
              Upload action as an icon button next to Filter, and the standard
              3-dots menu. The Icons/Details toggle moved into that menu
              instead of sitting in the row (§6a still applies: the icon grid
              only ever renders once populated). */}
          <div
            className="flex flex-wrap items-center gap-2 border-b px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-line-soft)" }}
          >
            <nav aria-label="Folder path" className="flex min-w-0 flex-1 items-center gap-0.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setFolder("");
                  setSelected(null);
                }}
                className="rounded px-1.5 py-0.5 font-medium hover:bg-black/5"
                style={{ color: folder === "" ? "var(--color-navy)" : "var(--color-navy-mid)" }}
              >
                Artefacts
              </button>
              {crumbs.map((crumb, index) => {
                const target = crumbs.slice(0, index + 1).join("/");
                const isLast = index === crumbs.length - 1;
                return (
                  <span key={target} className="flex min-w-0 items-center">
                    <ChevronRight
                      className="size-3 shrink-0"
                      style={{ color: "var(--color-warm-gray)" }}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setFolder(target);
                        setSelected(null);
                      }}
                      aria-current={isLast ? "page" : undefined}
                      className="truncate rounded px-1.5 py-0.5 hover:bg-black/5"
                      style={{
                        color: isLast ? "var(--color-navy)" : "var(--color-navy-mid)",
                        fontWeight: isLast ? 600 : 400,
                      }}
                    >
                      {crumb}
                    </button>
                  </span>
                );
              })}
            </nav>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2"
                style={{ color: "var(--color-warm-gray)" }}
                aria-hidden="true"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                aria-label="Search Files in this folder"
                className="h-7 w-32 rounded-md border pl-7 pr-2 text-xs outline-none"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-background)",
                  color: "var(--color-navy)",
                }}
              />
            </div>

            <button
              type="button"
              disabled
              title="File type and date filters aren't wired yet."
              className="flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium disabled:opacity-45 disabled:cursor-not-allowed"
              style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
            >
              <Filter className="size-3.5" />
              Filter
            </button>

            <label
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border hover:bg-black/5"
              style={{ borderColor: "var(--color-border)" }}
              title={uploading ? "Copying locally…" : "Add local File"}
            >
              <Upload className="size-3.5" style={{ color: "var(--color-warm-gray)" }} />
              <span className="sr-only">{uploading ? "Copying locally…" : "Add local File"}</span>
              <input type="file" multiple className="sr-only" disabled={uploading} onChange={addFiles} />
            </label>

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="More Artefacts options"
                className="flex size-7 items-center justify-center rounded-md border hover:bg-black/5"
                style={{ borderColor: "var(--color-border)" }}
              >
                <MoreVertical className="size-3.5" style={{ color: "var(--color-warm-gray)" }} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-lg border bg-white shadow-lg"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    {([
                      ["icons", LayoutGrid, "Icons view"],
                      ["details", ListIcon, "Details view"],
                    ] as const).map(([mode, Icon, label]) => (
                      <button
                        key={mode}
                        type="button"
                        role="menuitemradio"
                        aria-checked={view === mode}
                        onClick={() => {
                          setView(mode);
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-[var(--color-surface)]"
                        style={{ color: view === mode ? "var(--color-navy)" : "var(--color-navy-mid)" }}
                      >
                        <Icon className="size-3.5" />
                        {label}
                        {view === mode && <Check className="ml-auto size-3.5" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* EMPTY = AN EMPTY SECTION, NOT A MESSAGE (user directive
              2026-08-10: "Same for artefacts. I want the visual aesthetics
              retained even if empty"). This SUPERSEDES the older §6a rule
              that specified a one-line note and "no folder icon grid" — the
              toolbar, frame and footer now hold their shape at zero Files and
              the body is simply blank. */}
          {entries.length === 0 ? (
            <div style={{ minHeight: EMPTY_BODY_MIN_HEIGHT }} />
          ) : view === "details" ? (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr style={{ background: "var(--color-background)" }}>
                  {([
                    ["name", "Name", "left"],
                    ["size", "Size", "right"],
                    ["modifiedAt", "Date modified", "right"],
                  ] as const).map(([key, label, align]) => (
                    <th
                      key={key}
                      scope="col"
                      aria-sort={
                        sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                      }
                      style={{
                        height: ROW_HEIGHT,
                        paddingLeft: CELL_PAD_X,
                        paddingRight: CELL_PAD_X,
                        color: "var(--color-warm-gray)",
                        borderBottom: "1px solid var(--color-border)",
                        textAlign: align,
                      }}
                      className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.07em]"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className="inline-flex items-center gap-1 hover:opacity-70"
                      >
                        {label}
                        {sortKey === key && (
                          <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const Icon = iconFor(entry);
                  const isSelected = selected === entry.path;
                  return (
                    <tr
                      key={entry.path}
                      onClick={() => setSelected(entry.path)}
                      onDoubleClick={() => openEntry(entry)}
                      aria-selected={isSelected}
                      className="bridge-table-row cursor-default"
                      style={{
                        height: ROW_HEIGHT,
                        background: isSelected ? "var(--color-row-hover)" : undefined,
                        borderBottom: "1px solid var(--color-line-soft)",
                      }}
                    >
                      <td
                        style={{ paddingLeft: CELL_PAD_X, paddingRight: CELL_PAD_X }}
                        className="max-w-0 align-middle"
                      >
                        <span className="flex items-center gap-2">
                          <Icon
                            className="size-4 shrink-0"
                            style={{
                              color: entry.isDirectory
                                ? "var(--color-steel)"
                                : "var(--color-warm-gray)",
                            }}
                            aria-hidden="true"
                          />
                          <span className="truncate" style={{ color: "var(--color-navy)" }}>
                            {entry.name}
                          </span>
                        </span>
                      </td>
                      <td
                        style={{
                          paddingLeft: CELL_PAD_X,
                          paddingRight: CELL_PAD_X,
                          color: "var(--color-warm-gray)",
                        }}
                        className="whitespace-nowrap text-right align-middle tabular-nums"
                      >
                        {formatBytes(entry.size)}
                      </td>
                      <td
                        style={{
                          paddingLeft: CELL_PAD_X,
                          paddingRight: CELL_PAD_X,
                          color: "var(--color-warm-gray)",
                        }}
                        className="whitespace-nowrap text-right align-middle tabular-nums"
                      >
                        {new Date(entry.modifiedAt).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div
              ref={gridRef}
              className="grid gap-1 p-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))" }}
            >
              {entries.map((entry) => {
                const Icon = iconFor(entry);
                const isSelected = selected === entry.path;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => setSelected(entry.path)}
                    onDoubleClick={() => openEntry(entry)}
                    aria-pressed={isSelected}
                    title={
                      entry.isDirectory
                        ? `${entry.name} — ${entry.childCount} File${entry.childCount === 1 ? "" : "s"}, ${formatBytes(entry.size)}`
                        : `${entry.name} — ${formatBytes(entry.size)}, ${new Date(entry.modifiedAt).toLocaleString()}`
                    }
                    className="flex flex-col items-center gap-1.5 rounded-lg p-3"
                    style={{ background: isSelected ? "var(--color-row-hover)" : "transparent" }}
                  >
                    <Icon
                      className="size-10"
                      strokeWidth={1.25}
                      style={{
                        color: entry.isDirectory ? "var(--color-steel)" : "var(--color-warm-gray)",
                      }}
                      aria-hidden="true"
                    />
                    <span
                      className="line-clamp-2 w-full break-all text-center text-[11px] leading-tight"
                      style={{ color: "var(--color-navy)" }}
                    >
                      {entry.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Footer always renders — it is the section's bottom edge, and it
              carries the Local Plane path, which is the residency disclosure
              this surface owes the user whether or not any File exists yet. */}
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-1.5 text-[11px]"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-line-soft)",
              color: "var(--color-warm-gray)",
            }}
          >
            <span>
              {entries.length} item{entries.length === 1 ? "" : "s"}
              {inventory?.truncated && " · showing the first 200 local Files"}
            </span>
            <span className="truncate" title={inventory?.root}>
              {inventory?.root}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
