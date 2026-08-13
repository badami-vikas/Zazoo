/**
 * ClassToolsSection (ADR-238) — launches a self-contained local HTML tool
 * (e.g. the PE Methods venture-return-calculator) straight from a Module's
 * existing Local Files inventory. No new storage, no new upload path: a
 * "Class Tool" is just any `.html` File already sitting in Files (the SAME
 * `modules.files` inventory `ModuleFilesSection` reads), opened through the
 * read-only `modules.getFileContent` counterpart to `addFile`.
 *
 * Adding a second tool later needs zero new plumbing — drop another
 * self-contained `.html` File into Files (Upload button, or `modules.addFile`)
 * and it appears here automatically. "Self-contained" is on the author: CSS
 * and JS must be inlined (a relative `<script src="script.js">` cannot
 * resolve once the File is decoded into a `srcDoc`, since only ONE File's
 * bytes ever cross this path) — external absolute URLs (a CDN, web fonts)
 * still work, since the sandboxed iframe still makes real subresource
 * requests, only top-level navigation/popups/forms are restricted.
 */
import { useEffect, useMemo, useState } from "react";
import { Wrench, X } from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../../lib/trpc";

type FileInventory = Awaited<ReturnType<typeof trpc.modules.files.query>>;

function base64ToText(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

export function ClassToolsSection({ moduleName }: { moduleName: string }) {
  const [inventory, setInventory] = useState<FileInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [toolHtml, setToolHtml] = useState<string | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const [loadingTool, setLoadingTool] = useState(false);

  useEffect(() => {
    let active = true;
    trpc.modules.files
      .query({ organizationId: PILOT_ORGANIZATION, moduleName })
      .then((next) => {
        if (active) setInventory(next);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [moduleName]);

  const tools = useMemo(
    () => (inventory?.items ?? []).filter((item) => item.path.toLowerCase().endsWith(".html")),
    [inventory],
  );

  async function launch(path: string) {
    setOpenTool(path);
    setToolHtml(null);
    setToolError(null);
    setLoadingTool(true);
    try {
      const file = await trpc.modules.getFileContent.query({
        organizationId: PILOT_ORGANIZATION,
        moduleName,
        fileName: path,
      });
      setToolHtml(base64ToText(file.contentBase64));
    } catch (cause) {
      setToolError(String(cause));
    } finally {
      setLoadingTool(false);
    }
  }

  if (error) return null; // Same degrade-quietly posture as the Files Section's supplementary reads.
  if (tools.length === 0) return null; // Nothing to launch — no empty-state card for a Section that may never apply to this Module.

  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)" }}
      aria-labelledby={`${moduleName}-class-tools-title`}
    >
      <h2 id={`${moduleName}-class-tools-title`} className="text-sm font-medium">
        Class Tools
      </h2>
      <div className="flex flex-wrap gap-2">
        {tools.map((tool) => (
          <button
            key={tool.path}
            type="button"
            onClick={() => void launch(tool.path)}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/5"
            style={{ borderColor: "var(--color-border)" }}
          >
            <Wrench className="size-4" style={{ color: "var(--color-warm-gray)" }} aria-hidden="true" />
            {tool.path.replace(/\.html?$/i, "")}
          </button>
        ))}
      </div>

      {openTool ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={openTool}>
          <div className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-white" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
              <span className="truncate text-sm font-medium">{openTool}</span>
              <button
                type="button"
                onClick={() => setOpenTool(null)}
                aria-label="Close Class Tool"
                className="flex size-7 items-center justify-center rounded-md hover:bg-black/5"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              {loadingTool ? (
                <div className="p-4 text-sm text-muted-foreground">Loading…</div>
              ) : toolError ? (
                <div className="p-4 text-sm text-red-600 break-words">{toolError}</div>
              ) : toolHtml !== null ? (
                <iframe
                  title={openTool}
                  srcDoc={toolHtml}
                  sandbox="allow-scripts"
                  className="size-full border-0"
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
