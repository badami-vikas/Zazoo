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
 *
 * ADD FROM COMMONS (user report 2026-09-08: "why are not all commons module
 * selectable when new option below modules is clicked?"). This dialog only
 * ever offered Modules already INSTALLED — it means "start something in a
 * Module you have", and there was no surface anywhere in the app for the other
 * half: browsing Commons and installing from it. `commons.installPropose` →
 * `modules.install` existed and was reachable from nothing, so a Module that
 * sat in the registry could not be added except by hand.
 *
 * The two halves stay in ONE dialog rather than a separate catalog page,
 * because "I want to start something new" is the same intent whether the
 * Module is already here or not, and asking the person to know which case they
 * are in before they can look is the reason this was never found.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ChevronRight, Boxes, Download, Sparkles } from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { MODULES_CHANGED_EVENT } from "../chat/useChat";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

interface ModuleOption {
  moduleName: string;
  version: string;
  to: string;
  label: string;
  desc: string;
}

type ConverseResult = Awaited<ReturnType<typeof trpc.chiefOfStaff.converse.mutate>>;
type CommonsOption = Awaited<ReturnType<typeof trpc.commons.list.query>>["items"][number];

export function NewModuleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [modules, setModules] = useState<ModuleOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ModuleOption | null>(null);
  const [recommendation, setRecommendation] = useState<ConverseResult | null>(null);
  const [converseError, setConverseError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [commons, setCommons] = useState<CommonsOption[] | null>(null);
  const [commonsError, setCommonsError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installNote, setInstallNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const installed = await trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .catch((e) => {
        setLoadError(String(e));
        return null;
      });
    if (!installed) return;
    const rows = installed.items.filter(
      (r) =>
        r.state === "available" &&
        r.status === "installed" &&
        r.manifest.module !== undefined &&
        r.moduleAttachment === undefined,
    );
    setModules(
      rows.map((r) => ({
        moduleName: r.moduleName,
        version: r.moduleVersion,
        to: r.manifest.module!.route,
        label: r.manifest.module!.displayName,
        desc: r.manifest.description,
      })),
    );
    // Everything the person could ADD: root Modules in the registry that are
    // not already theirs. A Skill in Commons is installed against a declared
    // Module need, not started from here, so it is not on offer.
    const have = new Set(installed.items.map((r) => r.moduleName));
    try {
      const catalog = await trpc.commons.list.query({
        kind: "organization_definition",
        limit: 100,
        offset: 0,
      });
      setCommons(catalog.items.filter((item) => !have.has(item.name)));
    } catch (e) {
      // A registry that is unreachable is worth SAYING so, not hiding: the
      // whole reason this section exists is that its absence was silent.
      setCommonsError(String(e));
      setCommons([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Reset per open so a stale recommendation never carries over.
    setPicked(null);
    setRecommendation(null);
    setConverseError(null);
    setInstallNote(null);
    setCommonsError(null);
    void load();
  }, [open, load]);

  async function install(entry: CommonsOption) {
    setInstalling(entry.name);
    setInstallNote(null);
    try {
      // The same two steps the Commons capability panel takes: propose stages
      // the manifest, `modules.install` puts it through governance. An install
      // the pipeline holds for review is NOT installed, and says so.
      const proposed = await trpc.commons.installPropose.mutate({
        organizationId: PILOT_ORGANIZATION,
        name: entry.name,
        version: entry.latestVersion,
      });
      const result = await trpc.modules.install.mutate({
        organizationId: PILOT_ORGANIZATION,
        installationId: proposed.installation.id,
        todayKey: new Date().toISOString().slice(0, 10),
      });
      if (!result.installed) {
        setInstallNote(`${entry.name} is waiting for your approval before it installs.`);
        return;
      }
      await trpc.modules.promote.mutate({
        organizationId: PILOT_ORGANIZATION,
        installationId: proposed.installation.id,
      });
      setInstallNote(`${entry.name} installed.`);
      // The rail reads its Modules from the same list; tell it to re-read
      // rather than leaving the new Module invisible until a reload.
      window.dispatchEvent(new Event(MODULES_CHANGED_EVENT));
      await load();
    } catch (e) {
      setInstallNote(`Could not install ${entry.name}: ${String(e)}`);
    } finally {
      setInstalling(null);
    }
  }

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
                No Modules installed yet. Add one from Commons below.
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

            {commons !== null && commons.length > 0 && (
              <>
                <div className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Add from Commons
                </div>
                <ul className="divide-y border rounded-md">
                  {commons.map((entry) => (
                    <li key={entry.name}>
                      <button
                        type="button"
                        disabled={installing !== null}
                        className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
                        onClick={() => void install(entry)}
                      >
                        <Download className="w-4 h-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium truncate">{entry.name}</span>
                          <span className="block text-xs text-muted-foreground truncate">{entry.summary}</span>
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {installing === entry.name ? "Installing…" : `v${entry.latestVersion}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {commonsError && (
              <div className="text-xs text-muted-foreground break-words">
                Commons is unreachable, so nothing can be added right now. {commonsError}
              </div>
            )}
            {installNote && <div className="text-sm break-words">{installNote}</div>}
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
