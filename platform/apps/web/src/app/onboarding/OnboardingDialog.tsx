import { useMemo, useState } from "react";
import { compileBlueprint, type CompiledWorkspace } from "@bridge/core";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Badge } from "../components/ui/badge";
import { nextQuestion, buildBlueprintFromAnswers, isComplete, type OnboardingAnswers } from "./questions";

/** Mirrors apps/api/src/router.ts's BLUEPRINT_NODE_TYPE_REGISTRY /
 * WorkspacePage.tsx's REGISTERED_NODE_TYPES — same hand-kept-in-sync caveat
 * documented there (no shared runtime registry endpoint yet). Kept local to
 * the preview compile only; the server independently re-validates on propose. */
const REGISTERED_NODE_TYPES = [
  "person",
  "community",
  "initiative",
  "touchpoint",
  "ritual",
  "tool",
  "file",
  "signal",
  "policy",
  "policy_param",
  "skill",
  "agent",
  "role",
  "permission",
  "ledger",
  "delegation",
  "integration",
  "network_graph:full",
  "external:send",
  "external:fetch",
  "edge",
] as const;

export interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful propose — lets the caller (App shell) refresh
   * its "does an active workspace exist" check without a full page reload.
   * MUST NOT close the dialog itself (that was the cause of the "dialog
   * auto-closes before the success message can be read" cosmetic bug,
   * docs/BUGS.md 2026-07-06): this component is `open`-controlled, so if the
   * caller's `onProposed` flips `open` to false, the "submitted" step's
   * message never gets a render. The dialog now only closes via the explicit
   * "Done" button (`resetAndClose`) or the user dismissing it. */
  onProposed?: () => void;
}

type Step = "questions" | "preview" | "submitted";

/** Outcome of the propose→activate chain, so the final step can tell the user
 * what ACTUALLY happened instead of a generic "check Approvals" that may be
 * empty (the dead-end bug in BUGS.md, found live-testing 2026-07-06). */
type SubmitOutcome = "activated" | "pending_review" | null;

/**
 * Onboarding pop-up (docs/wiki/clients.md: "pop-up screen, not a separate
 * page/app" — user decision 2026-07-06). Runs the adaptive question set from
 * ./questions.ts, compiles a live preview with the SAME compileBlueprint()
 * apps/api validates against server-side, and submits via
 * workspace.blueprint.propose followed by workspace.blueprint.activate — the
 * activation is itself a governed pipeline proposal (ledgered; parks in
 * Approvals when policy requires human review), so chaining them never skips
 * governance, it just makes the outcome visible. The pre-apply preview +
 * approval requirement is the moat documented in roadmap.md ("NO competitor
 * ships pre-apply approval").
 *
 * Dismissible + re-openable: this component is purely controlled (`open`/
 * `onOpenChange`) so the sidebar can reopen it at any time; it does not track
 * "has onboarding ever run" itself — App.tsx's mount-time
 * workspace.blueprint.get check owns that decision.
 */
export function OnboardingDialog({ open, onOpenChange, onProposed }: OnboardingDialogProps) {
  const [answers, setAnswers] = useState<OnboardingAnswers>({});
  const [step, setStep] = useState<Step>("questions");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [outcome, setOutcome] = useState<SubmitOutcome>(null);

  const question = useMemo(() => nextQuestion(answers), [answers]);
  const blueprint = useMemo(() => buildBlueprintFromAnswers(answers), [answers]);

  const compiled: CompiledWorkspace | { error: string } | null = useMemo(() => {
    if (step !== "preview") return null;
    try {
      return compileBlueprint(blueprint, REGISTERED_NODE_TYPES, ["edge"]);
    } catch (e) {
      return { error: String(e) };
    }
  }, [step, blueprint]);

  function resetAndClose() {
    setAnswers({});
    setStep("questions");
    setError(null);
    setTextDraft("");
    setOutcome(null);
    onOpenChange(false);
  }

  function answer(id: string, value: string | string[]) {
    const updated = { ...answers, [id]: value };
    setAnswers(updated);
    setTextDraft("");
    if (isComplete(updated)) setStep("preview");
  }

  function toggleMulti(id: string, value: string) {
    const current = (answers[id] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setAnswers({ ...answers, [id]: next });
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      // propose writes the draft; activate is the governed step (pipeline
      // round-trip, ledgered). Without chaining them the draft was orphaned:
      // Approvals showed nothing and /workspace stayed empty (BUGS.md
      // 2026-07-06 "onboarding leaves an orphaned draft").
      const { definition } = await trpc.workspace.blueprint.propose.mutate({
        workspaceId: PILOT_WORKSPACE,
        blueprint,
      });
      const result = await trpc.workspace.blueprint.activate.mutate({
        workspaceId: PILOT_WORKSPACE,
        definitionId: definition.id,
      });
      setOutcome(result.activated ? "activated" : "pending_review");
      setStep("submitted");
      onProposed?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set up your workspace</DialogTitle>
          <DialogDescription>
            A few quick questions — Bridge generates a starting workspace from your answers. Nothing is created until
            you approve it.
          </DialogDescription>
        </DialogHeader>

        {step === "questions" && question && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{question.prompt}</p>
              {question.helpText && <p className="text-xs text-muted-foreground">{question.helpText}</p>}
            </div>

            {question.kind === "single_select" && (
              <div className="flex flex-col gap-2">
                {question.options?.map((opt) => (
                  <Button
                    key={opt.value}
                    variant="outline"
                    className="justify-start"
                    onClick={() => answer(question.id, opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            )}

            {question.kind === "multi_select" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {question.options?.map((opt) => {
                    const selected = ((answers[question.id] as string[] | undefined) ?? []).includes(opt.value);
                    return (
                      <Badge
                        key={opt.value}
                        variant={selected ? "default" : "outline"}
                        className="cursor-pointer select-none py-1.5 px-3"
                        onClick={() => toggleMulti(question.id, opt.value)}
                      >
                        {opt.label}
                      </Badge>
                    );
                  })}
                </div>
                <Button size="sm" onClick={() => answer(question.id, (answers[question.id] as string[] | undefined) ?? [])}>
                  Continue
                </Button>
              </div>
            )}

            {question.kind === "text" && (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder={question.placeholder}
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && textDraft.trim()) answer(question.id, textDraft.trim());
                  }}
                />
                <Button disabled={!textDraft.trim()} onClick={() => answer(question.id, textDraft.trim())}>
                  Next
                </Button>
              </div>
            )}
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Preview — this is what will be proposed</p>
            {compiled && "error" in compiled ? (
              <div className="text-sm text-red-600 border rounded-md p-3">{compiled.error}</div>
            ) : (
              <div className="border rounded-md p-3 space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Entities: </span>
                  {blueprint.entities.map((e) => blueprint.vocabulary[e.label] ?? e.label).join(", ") || "none"}
                </div>
                <div>
                  <span className="text-muted-foreground">Views: </span>
                  {compiled && "viewConfigs" in compiled
                    ? compiled.viewConfigs.map((v) => `${v.entity} (${v.kind})`).join(", ")
                    : "—"}
                </div>
                <div className="text-xs text-muted-foreground pt-1">
                  Honest note: submitting proposes this through governance. If policy requires review, it waits in
                  Approvals; otherwise it activates immediately.
                </div>
              </div>
            )}
            {error && <div className="text-sm text-red-600">{error}</div>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("questions")} disabled={submitting}>
                Back
              </Button>
              <Button onClick={submit} disabled={submitting || (compiled !== null && "error" in compiled)}>
                {submitting ? "Submitting…" : "Propose this workspace"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "submitted" && (
          <div className="space-y-3">
            {outcome === "activated" ? (
              <p className="text-sm">
                Your workspace is live. Open the <strong>Workspace</strong> page to see it — every change from here on
                goes through the same propose-and-approve flow you just used.
              </p>
            ) : (
              <p className="text-sm">
                Proposed. Governance policy requires a human decision on this one — it's waiting in the{" "}
                <strong>Approvals</strong> inbox and applies the moment it's approved.
              </p>
            )}
            <DialogFooter>
              <Button onClick={resetAndClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
