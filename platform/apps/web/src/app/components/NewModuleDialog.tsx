/**
 * "+ New" flow (v1 minimal, requests.md R-017..R-020):
 *   1. Pick an installed Module — REAL `modules.list` rows in `available`
 *      state whose manifest declares a navigable surface. Honest empty
 *      state when nothing is installed; nothing is fabricated.
 *   2. Chief of Staff recommendation — calls the REAL `chiefOfStaff.converse`
 *      mutation with a new-vs-extend question and renders its ACTUAL reply
 *      (never a canned recommendation).
 *   3. Confirm → navigate to the Module's surface. Override → back to the
 *      picker (the recommendation is advice, not a gate).
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ChevronRight, Boxes, Sparkles } from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

interface ModuleOption {
  moduleName: string;
  version: string;
  to: string;
  label: string;
  desc: string;
}

type ConverseResult = Awaited<ReturnType<typeof trpc.chiefOfStaff.converse.mutate>>;

export function NewModuleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [modules, setModules] = useState<ModuleOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ModuleOption | null>(null);
  const [recommendation, setRecommendation] = useState<ConverseResult | null>(null);
  const [converseError, setConverseError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reset per open so a stale recommendation never carries over.
    setPicked(null);
    setRecommendation(null);
    setConverseError(null);
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((res) => {
        setModules(
          res.items
            .filter(
              (r) =>
                r.state === "available" &&
                r.status === "installed" &&
                r.manifest.module !== undefined &&
                r.moduleAttachment === undefined,
            )
            .map((r) => ({
              moduleName: r.moduleName,
              version: r.moduleVersion,
              to: r.manifest.module!.route,
              label: r.manifest.module!.displayName,
              desc: r.manifest.description,
            })),
        );
      })
      .catch((e) => setLoadError(String(e)));
  }, [open]);

  async function pickModule(m: ModuleOption) {
    setPicked(m);
    setRecommendation(null);
    setConverseError(null);
    setAsking(true);
    try {
      const res = await trpc.chiefOfStaff.converse.mutate({
        organizationId: PILOT_ORGANIZATION,
        message:
          `I want to start something new with the ${m.label} module (${m.desc}). ` +
          `Should this be a brand-new Record or an extension of an existing Record? ` +
          `Please analyse new-vs-extend and recommend one.`,
      });
      setRecommendation(res);
    } catch (e) {
      setConverseError(String(e));
    } finally {
      setAsking(false);
    }
  }

  function confirm() {
    if (!picked) return;
    onOpenChange(false);
    navigate(picked.to);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {picked === null ? (
          <>
            <DialogHeader>
              <DialogTitle>New</DialogTitle>
              <DialogDescription>Pick a Module to start from.</DialogDescription>
            </DialogHeader>
            {loadError && <div className="text-sm text-red-600 break-words">{loadError}</div>}
            {!loadError && modules === null && <div className="text-sm text-muted-foreground">Loading Modules…</div>}
            {modules !== null && modules.length === 0 && (
              <div className="p-4 border rounded-md text-sm text-muted-foreground">
                No Modules installed yet. Modules appear here once installed — see Settings → Intelligence.
              </div>
            )}
            {modules !== null && modules.length > 0 && (
              <ul className="divide-y border rounded-md">
                {modules.map((m) => (
                  <li key={m.moduleName}>
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => void pickModule(m)}
                    >
                      <Boxes className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{m.label}</span>
                        <span className="block text-xs text-muted-foreground truncate">{m.desc}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-muted-foreground" />
                Chief of Staff
              </DialogTitle>
              <DialogDescription>New Record or extend an existing one — with {picked.label}?</DialogDescription>
            </DialogHeader>

            {asking && <div className="text-sm text-muted-foreground">Asking the Chief of Staff…</div>}
            {converseError && <div className="text-sm text-red-600 break-words">{converseError}</div>}
            {recommendation && (
              <div className="border rounded-md p-3 text-sm space-y-2">
                <div>{recommendation.reply}</div>
                {recommendation.decision?.reason && (
                  <div className="text-xs text-muted-foreground">{recommendation.decision.reason}</div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setPicked(null)}
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Override — pick differently
              </button>
              <button
                type="button"
                disabled={asking}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                onClick={confirm}
              >
                Confirm — open {picked.label}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
