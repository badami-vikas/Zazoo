import { useEffect, useState, type ChangeEvent } from "react";
import { FolderOpen, Upload } from "lucide-react";
import { trpc, PILOT_WORKSPACE } from "../../lib/trpc";

type FileInventory = Awaited<ReturnType<typeof trpc.packages.files.query>>;

const MAX_FILE_BYTES = 10 * 1024 * 1024;

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

export function ModuleFilesSection({
  moduleName,
  title = "Files",
}: {
  moduleName: string;
  title?: string;
}) {
  const [inventory, setInventory] = useState<FileInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void trpc.packages.files.query({
      workspaceId: PILOT_WORKSPACE,
      moduleName,
    }).then((next) => {
      if (active) setInventory(next);
    }).catch((cause) => {
      if (active) setError(String(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [moduleName, refresh]);

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (selected.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of selected) {
        if (file.size > MAX_FILE_BYTES) {
          throw new Error(`${file.name} exceeds the 10 MB local File limit.`);
        }
        await trpc.packages.addFile.mutate({
          workspaceId: PILOT_WORKSPACE,
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

  return (
    <section className="space-y-3" aria-labelledby={`${moduleName}-files-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FolderOpen className="size-4" style={{ color: "var(--color-steel)" }} />
          <h2 id={`${moduleName}-files-title`} className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>
            {title}
          </h2>
        </div>
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-[var(--color-surface)]">
          <Upload className="size-3.5" />
          {uploading ? "Copying locally…" : "Add local File"}
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={uploading}
            onChange={addFiles}
          />
        </label>
      </div>
      {loading ? (
        <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>Loading local File inventory…</p>
      ) : error ? (
        <p role="alert" className="break-words text-xs text-red-600">{error}</p>
      ) : inventory && inventory.items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
          <p className="border-b p-3 text-xs break-all" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
            {inventory.root}
          </p>
          <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {inventory.items.map((file) => (
              <li key={file.path} className="p-3">
                <p className="break-all text-sm font-medium" style={{ color: "var(--color-navy)" }}>{file.path}</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                  {file.size.toLocaleString()} bytes · {new Date(file.modifiedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
          {inventory.truncated && (
            <p className="border-t p-3 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
              Showing the first 200 local Files.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
          <p>No local Files yet.</p>
          {inventory?.root && <p className="mt-1 break-all">{inventory.root}</p>}
        </div>
      )}
      <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
        The picker copies selected Files into this Module's Local Plane folder.
      </p>
    </section>
  );
}
