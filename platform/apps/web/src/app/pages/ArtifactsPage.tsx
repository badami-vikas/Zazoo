import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  FileText,
  Folder,
  FolderPlus,
  Search,
  Upload,
} from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";

type FileInventory = Awaited<ReturnType<typeof trpc.modules.files.query>>;
type FileItem = FileInventory["items"][number];

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("File could not be read."));
    reader.onload = () => {
      if (typeof reader.result !== "string") { reject(new Error("File could not be encoded.")); return; }
      const sep = reader.result.indexOf(",");
      resolve(sep >= 0 ? reader.result.slice(sep + 1) : reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
}

function isFolder(item: FileItem): boolean {
  return item.size === 0 && !extOf(item.path);
}

type IconVariant = "folder" | "pdf" | "doc" | "sheet" | "other";

function iconVariant(item: FileItem): IconVariant {
  if (isFolder(item)) return "folder";
  const ext = extOf(item.path);
  if (["pdf"].includes(ext)) return "pdf";
  if (["doc", "docx", "txt", "md"].includes(ext)) return "doc";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  return "other";
}

const VARIANT_COLORS: Record<IconVariant, { bg: string; fg: string; border: string }> = {
  folder:  { bg: "#F5ECD7", fg: "#B08A3A", border: "#E8D5A8" },
  pdf:     { bg: "#FEE2E2", fg: "#DC2626", border: "#FECACA" },
  doc:     { bg: "#DBEAFE", fg: "#2563EB", border: "#BFDBFE" },
  sheet:   { bg: "#DCFCE7", fg: "#16A34A", border: "#BBF7D0" },
  other:   { bg: "#F1F5F9", fg: "#64748B", border: "#E2E8F0" },
};

function ArtifactIcon({ variant, size = 56 }: { variant: IconVariant; size?: number }) {
  const c = VARIANT_COLORS[variant];
  return (
    <span
      className="flex items-center justify-center rounded-xl"
      style={{
        width: size,
        height: size,
        background: c.bg,
        border: `1.5px solid ${c.border}`,
        flexShrink: 0,
      }}
    >
      {variant === "folder"
        ? <Folder size={size * 0.46} style={{ color: c.fg }} />
        : <FileText size={size * 0.42} style={{ color: c.fg }} />}
    </span>
  );
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? path;
}

export function ArtifactsPage() {
  const [inventory, setInventory] = useState<FileInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void trpc.modules.files.query({ organizationId: PILOT_ORGANIZATION, moduleName: "deal-pilot" })
      .then((data) => { if (active) setInventory(data); })
      .catch((cause) => { if (active) setError(String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (!selected.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of selected) {
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds the 10 MB limit.`);
        await trpc.modules.addFile.mutate({
          organizationId: PILOT_ORGANIZATION,
          moduleName: "deal-pilot",
          fileName: file.name,
          contentBase64: await fileBase64(file),
        });
      }
      setRefresh((v) => v + 1);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setUploading(false);
    }
  }

  const items = useMemo<FileItem[]>(() => {
    const all = inventory?.items ?? [];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((item) => basename(item.path).toLowerCase().includes(q));
  }, [inventory?.items, query]);

  const count = inventory?.items.length ?? 0;

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--color-border)", backgroundColor: "white" }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <h1 className="text-sm font-bold tracking-wide uppercase" style={{ color: "var(--color-navy)" }}>
            Artifacts
          </h1>
          <span
            className="text-xs font-semibold rounded-full px-2 py-0.5"
            style={{ backgroundColor: "var(--color-surface)", color: "var(--color-warm-gray)", border: "1px solid var(--color-border)" }}
          >
            {count}
          </span>
          {/* Search */}
          <label className="relative flex items-center ml-2">
            <Search
              className="absolute left-2.5 size-3.5 pointer-events-none"
              style={{ color: "var(--color-warm-gray)" }}
            />
            <input
              type="search"
              placeholder="Search artifacts..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 rounded-lg border pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-[var(--color-steel)]"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-surface)",
                color: "var(--color-navy)",
                width: 200,
              }}
            />
          </label>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Upload */}
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-[var(--color-surface)] transition-colors">
            <Upload className="size-3.5" style={{ color: "var(--color-steel)" }} />
            {uploading ? "Uploading…" : "Upload"}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              disabled={uploading}
              onChange={handleUpload}
            />
          </label>
          {/* New folder — UI affordance only; governed folder creation pending CoS integration */}
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--color-steel)" }}
            onClick={() => fileInputRef.current?.click()}
            title="New folder (coming soon)"
          >
            <FolderPlus className="size-3.5" />
            + New folder
          </button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <p className="text-sm" style={{ color: "var(--color-warm-gray)" }}>Loading artifacts…</p>
        ) : error ? (
          /Local Plane|public cloud/i.test(error) ? (
            <div
              className="rounded-xl border border-dashed p-8 text-center text-sm max-w-md mx-auto mt-12"
              style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
            >
              <Folder className="size-8 mx-auto mb-3 opacity-40" />
              <p className="font-medium" style={{ color: "var(--color-navy)" }}>Artifacts live on the desktop app</p>
              <p className="mt-1 text-xs">Local Files are stored on your Local Plane and are not served by the public cloud. Open the Bridge desktop app to browse artifacts.</p>
            </div>
          ) : (
            <p role="alert" className="text-sm text-red-600">{error}</p>
          )
        ) : items.length === 0 ? (
          <div
            className="rounded-xl border border-dashed p-10 text-center max-w-sm mx-auto mt-12"
            style={{ borderColor: "var(--color-border)" }}
          >
            <Folder className="size-10 mx-auto mb-3 opacity-30" style={{ color: "var(--color-steel)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
              {query ? "No artifacts match your search" : "No artifacts yet"}
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
              {query
                ? "Try a different search term or clear the filter."
                : "Exports, briefs, and files generated by DealPilot will appear here."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
            {items.map((item) => {
              const variant = iconVariant(item);
              const name = basename(item.path);
              return (
                <button
                  key={item.path}
                  type="button"
                  className="group flex flex-col items-center gap-2 rounded-xl p-3 text-center transition-colors hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-steel)]"
                  title={name}
                >
                  <ArtifactIcon variant={variant} size={56} />
                  <span
                    className="line-clamp-2 text-xs font-medium leading-snug"
                    style={{ color: "var(--color-navy)", wordBreak: "break-word" }}
                  >
                    {name}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {inventory?.truncated && (
          <p className="mt-4 text-xs text-center" style={{ color: "var(--color-warm-gray)" }}>
            Showing first 200 artifacts.
          </p>
        )}
      </div>
    </div>
  );
}
