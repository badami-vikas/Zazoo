import { useEffect, useMemo, useState } from "react";
import { compileBlueprint, type CompiledWorkspace } from "@bridge/core";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Badge } from "../components/ui/badge";
import { nextQuestion, buildBlueprintFromAnswers, isComplete, answeredCount, MAX_QUESTIONS, workspaceNameFromEmail, type OnboardingAnswers } from "./questions";
import { EggHatcher, type EggStage } from "../avatar/EggHatcher";
import {
  dispatchCaptureEvent,
  updateAvatarPrefs,
  type AvatarPrefs,
  type SpiritAnimal,
} from "../avatar/avatar-store";

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
  /** Called once the egg's hatch animation resolves with real, saved avatar
   * prefs — lets the caller (Layout) mount <AvatarOverlay> immediately
   * without waiting for a remount/localStorage re-read (spec section 4 Stage
   * 6: "hatch animation, set eggHatched: true, overlay appears"). */
  onHatched?: (prefs: AvatarPrefs) => void;
  /** User's email address — used to pre-populate the workspace_name question
   * via workspaceNameFromEmail() per spec-workspace-naming.md. Optional: if
   * absent, the workspace_name field starts empty for the user to fill in. */
  userEmail?: string;
}

type Step = "trust" | "questions" | "preview" | "submitted";

/** Outcome of the propose→activate chain, so the final step can tell the user
 * what ACTUALLY happened instead of a generic "check Approvals" that may be
 * empty (the dead-end bug in BUGS.md, found live-testing 2026-07-06). */
type SubmitOutcome = "activated" | "pending_review" | null;
type RecommendationResult = Awaited<ReturnType<typeof trpc.onboarding.recommendFromRoleModel.mutate>>;
type RecommendationDecision = "pending" | "approving" | "approved" | "declined";

interface SensorDescriptor {
  id: string;
  availability: "available" | "needs_permission" | "not_implemented";
  permission_note?: string | null;
}

interface AppObservation {
  kind: string;
  ts: number;
  fields: {
    app_name?: string;
    bundle_id?: string;
  };
}

async function desktopInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!window.__BRIDGE_DESKTOP__ || !invoke) throw new Error("This check is available in the Bridge desktop app.");
  return invoke(command, args) as Promise<T>;
}

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
export function OnboardingDialog({ open, onOpenChange, onProposed, onHatched, userEmail }: OnboardingDialogProps) {
  const [answers, setAnswers] = useState<OnboardingAnswers>({});
  const [step, setStep] = useState<Step>("trust");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [outcome, setOutcome] = useState<SubmitOutcome>(null);
  const [eggStage, setEggStage] = useState<EggStage>("incubating");
  const [recommendationResult, setRecommendationResult] = useState<RecommendationResult | null>(null);
  const [recommendationDecision, setRecommendationDecision] = useState<RecommendationDecision>("pending");
  const [learningError, setLearningError] = useState<string | null>(null);
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const [screenSensor, setScreenSensor] = useState<SensorDescriptor | null>(null);
  const [trustCheckRunning, setTrustCheckRunning] = useState(false);
  const [trustCheckResult, setTrustCheckResult] = useState<{
    appName: string;
    memoryId: string;
  } | null>(null);
  const [trustCheckError, setTrustCheckError] = useState<string | null>(null);

  const question = useMemo(() => nextQuestion(answers), [answers]);
  const blueprint = useMemo(() => buildBlueprintFromAnswers(answers), [answers]);
  const spiritAnimal = (answers.spirit_animal as SpiritAnimal | undefined) ?? "owl";

  // Egg progress maps to REAL setup state, never a fake timer (spec section 4):
  //   questions answered -> 0..~0.7 of the way there
  //   preview reached (blueprint compiled, about to be proposed) -> ~0.9
  //   activated/hatching -> 1.0
  const answered = answeredCount(answers);
  const progress =
    step === "trust"
      ? 0
      : step === "questions"
      ? Math.min(0.7, (answered / MAX_QUESTIONS) * 0.7)
      : step === "preview"
        ? 0.9
        : 1;

  const eggStatusText =
    step === "trust"
      ? "Nothing observes your work until you choose a visible check"
      : step === "questions"
      ? answered === 0
        ? "Your Organization is hatching…"
        : `✓ ${answered} of ${Math.min(answered + 1, MAX_QUESTIONS)} questions answered`
      : step === "preview"
        ? "✓ Your proposed setup is ready"
        : outcome === "activated"
          ? "✓ Ready to proceed"
          : "✓ Proposed — awaiting approval";

  // Egg stage derives from step + outcome, not a separate tracked value, so
  // it can never drift out of sync with what actually happened. Deliberately
  // keyed on [step, outcome] only — spiritAnimal/answered/onHatched are read
  // at fire time (via closure), not re-triggers: re-running this effect on
  // every keystroke of unrelated answers would restart the hatch timer.
  useEffect(() => {
    if (step === "submitted" && outcome === "activated") {
      setEggStage("hatching");
      // Hatch animation capped well under 3s (spec: "<3s") and NEVER blocks
      // the Done button — this only flips the visual to "hatched" and saves
      // prefs; the user can already click Done at any point.
      const t = setTimeout(() => {
        setEggStage("hatched");
        const saved = updateAvatarPrefs({ animal: spiritAnimal, eggHatched: true });
        onHatched?.(saved);
      }, 1400);
      return () => clearTimeout(t);
    }
    if (step === "preview") setEggStage("ready");
    else if (step === "questions") setEggStage(answered > 0 ? "growing" : "incubating");
    return undefined;
  }, [step, outcome]);

  // Pre-populate the workspace_name text field with the email-derived name
  // (spec-workspace-naming.md) when that question becomes active. Only seeds
  // the draft once — the user can freely edit it before pressing Next.
  useEffect(() => {
    if (question?.id === "workspace_name" && textDraft === "" && userEmail) {
      setTextDraft(workspaceNameFromEmail(userEmail));
    }
  }, [question?.id]);

  useEffect(() => {
    if (!open || step !== "trust" || !window.__BRIDGE_DESKTOP__) return undefined;
    let active = true;
    async function pollPermissions() {
      const [accessibility, sensors] = await Promise.all([
        desktopInvoke<boolean>("ax_permission_status"),
        desktopInvoke<SensorDescriptor[]>("sensor_list"),
      ]);
      if (!active) return;
      setAccessibilityGranted(accessibility);
      setScreenSensor(sensors.find((sensor) => sensor.id === "screen") ?? null);
    }
    void pollPermissions().catch((permissionError) => setTrustCheckError(String(permissionError)));
    const interval = window.setInterval(() => {
      void pollPermissions().catch((permissionError) => setTrustCheckError(String(permissionError)));
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [open, step]);

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
    setStep("trust");
    setError(null);
    setTextDraft("");
    setOutcome(null);
    setEggStage("incubating");
    setRecommendationResult(null);
    setRecommendationDecision("pending");
    setLearningError(null);
    setTrustCheckResult(null);
    setTrustCheckError(null);
    onOpenChange(false);
  }

  function startOver() {
    setAnswers({});
    setStep("questions");
    setError(null);
    setTextDraft("");
    setOutcome(null);
    setRecommendationResult(null);
    setRecommendationDecision("pending");
    setLearningError(null);
  }

  async function runTrustCheck() {
    setTrustCheckRunning(true);
    setTrustCheckError(null);
    try {
      await desktopInvoke<void>("sensor_start", { sensorId: "apps" });
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      const observations = await desktopInvoke<AppObservation[]>("sensor_drain");
      const observation = observations.find((item) => item.kind === "apps" && item.fields.app_name);
      if (!observation?.fields.app_name) throw new Error("No foreground app observation arrived. Try the check once more.");
      const capturedAt = new Date(observation.ts).toISOString();
      const { memory } = await trpc.onboarding.recordTrustCapture.mutate({
        workspaceId: PILOT_WORKSPACE,
        appName: observation.fields.app_name,
        ...(observation.fields.bundle_id ? { bundleId: observation.fields.bundle_id } : {}),
        capturedAt,
      });
      dispatchCaptureEvent({ kind: "apps", memoryId: memory.id });
      setTrustCheckResult({ appName: observation.fields.app_name, memoryId: memory.id });
    } catch (captureError) {
      setTrustCheckError(String(captureError));
    } finally {
      if (window.__BRIDGE_DESKTOP__) {
        await desktopInvoke<void>("sensor_stop", { sensorId: "apps" }).catch(() => undefined);
      }
      setTrustCheckRunning(false);
    }
  }

  async function decideRecommendation(decision: "approve" | "veto") {
    if (!recommendationResult) return;
    setRecommendationDecision("approving");
    setLearningError(null);
    try {
      await trpc.action.decide.mutate({
        proposalId: recommendationResult.proposal.id,
        decision,
      });
      setRecommendationDecision(decision === "approve" ? "approved" : "declined");
    } catch (decisionError) {
      setRecommendationDecision("pending");
      setLearningError(`The recommendation is still awaiting review: ${String(decisionError)}`);
    }
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
      try {
        await trpc.onboarding.saveProfile.mutate({
          workspaceId: PILOT_WORKSPACE,
          animal: spiritAnimal,
          answers: Object.fromEntries(
            Object.entries(answers).filter((e): e is [string, string | string[]] => e[1] !== undefined)
          ),
          verificationMethod: null,
          connectedSourceIds: [],
        });
      } catch (profileFailure) {
        setLearningError(`Your Organization is saved, but learning preferences could not be persisted: ${String(profileFailure)}`);
      }
      const figure = typeof answers.role_model === "string" ? answers.role_model.trim() : "";
      const admiredFor = typeof answers.role_model_why === "string" ? answers.role_model_why.trim() : "";
      if (figure && admiredFor) {
        try {
          setRecommendationResult(
            await trpc.onboarding.recommendFromRoleModel.mutate({
              workspaceId: PILOT_WORKSPACE,
              figure,
              admiredFor,
            }),
          );
        } catch (learningFailure) {
          setLearningError(`Your setup is saved, but public-source research could not finish: ${String(learningFailure)}`);
        }
      }
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
          <DialogTitle>Set up Bridge</DialogTitle>
          <DialogDescription>
            A few quick questions help Bridge prepare something useful. Each one explains why it matters, and
            nothing is created or scheduled without your approval.
          </DialogDescription>
        </DialogHeader>

        <EggHatcher progress={progress} stage={eggStage} animal={spiritAnimal} statusText={eggStatusText} />

        {step === "trust" && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3 space-y-1 text-sm">
              <p className="font-medium">You stay in control of what Bridge can observe.</p>
              <p className="text-xs text-muted-foreground">
                Nothing runs in the background during setup. A capture happens only after you choose it, the avatar
                blinks, and an inspectable Memory is saved in your Local Plane.
              </p>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">Microphone</p>
                  <p className="text-muted-foreground">Why: voice can make requests faster. Consequence: no voice capture is built yet, so no permission is requested.</p>
                </div>
                <Badge variant="outline">Not requested</Badge>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">Accessibility</p>
                  <p className="text-muted-foreground">Why: it can help Bridge understand controls you point to. Consequence: this setup only checks the current OS grant; it does not read the accessibility tree.</p>
                </div>
                <Badge variant={accessibilityGranted ? "default" : "outline"}>
                  {window.__BRIDGE_DESKTOP__ ? (accessibilityGranted ? "Granted" : "Not granted") : "Desktop only"}
                </Badge>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">Screen recording</p>
                  <p className="text-muted-foreground">Why: future visual help can refer to what you choose to show. Consequence: screen capture is not implemented, so Bridge will not request or imply this permission.</p>
                  {screenSensor?.permission_note && <p className="mt-1 text-muted-foreground">{screenSensor.permission_note}</p>}
                </div>
                <Badge variant="outline">
                  {window.__BRIDGE_DESKTOP__ ? (screenSensor?.availability === "available" ? "Available" : "Unavailable") : "Desktop only"}
                </Badge>
              </div>
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">See one live, bounded example</p>
              <p className="text-xs text-muted-foreground">
                Bridge can read only the name of the foreground app once, blink, save that observation as a private
                Memory, and stop the provider immediately.
              </p>
              <Button variant="outline" onClick={() => void runTrustCheck()} disabled={trustCheckRunning || !window.__BRIDGE_DESKTOP__}>
                {trustCheckRunning ? "Checking once…" : "Show me the live check"}
              </Button>
              {trustCheckResult && (
                <p className="text-xs text-[var(--color-steel)]">
                  Blink — Bridge saw {trustCheckResult.appName}. Memory {trustCheckResult.memoryId.slice(0, 8)}… is inspectable in Settings → Learning.
                </p>
              )}
              {trustCheckError && <p className="text-xs text-red-600">{trustCheckError}</p>}
              {!window.__BRIDGE_DESKTOP__ && (
                <p className="text-xs text-muted-foreground">The browser preview cannot inspect OS permissions or perform the live check.</p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setStep("questions")}>
                {trustCheckResult ? "Continue" : "Continue with observation off"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "questions" && question && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{question.prompt}</p>
              {question.helpText && <p className="text-xs text-muted-foreground">{question.helpText}</p>}
              <p className="text-xs text-[var(--color-steel)]"><strong>Why:</strong> {question.why}</p>
              <p className="text-xs text-muted-foreground"><strong>Consequence:</strong> {question.consequence}</p>
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
                {question.id === "role_model" && (
                  <Button variant="ghost" onClick={() => answer(question.id, "")}>
                    Skip
                  </Button>
                )}
              </div>
            )}
            {answered > 0 && (
              <Button variant="ghost" size="sm" onClick={startOver}>
                Start over
              </Button>
            )}
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Review your starting setup</p>
            {compiled && "error" in compiled ? (
              <div className="text-sm text-red-600 border rounded-md p-3">{compiled.error}</div>
            ) : (
              <div className="border rounded-md p-3 space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Information you'll start with: </span>
                  {blueprint.entities.map((e) => blueprint.vocabulary[e.label] ?? e.label).join(", ") || "none"}
                </div>
                <div>
                  <span className="text-muted-foreground">Starting layouts: </span>
                  {compiled && "viewConfigs" in compiled
                    ? compiled.viewConfigs.map((v) => v.kind === "table" ? "List" : v.kind === "kanban" ? "Board" : "Calendar").join(", ")
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
                {submitting ? "Submitting…" : "Propose this setup"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "submitted" && (
          <div className="space-y-3">
            {outcome === "activated" ? (
              <p className="text-sm">
                Your Organization is live, and your avatar has hatched — look for it in the corner from now on. Every
                capture it notices becomes an inspectable Memory entry. Open the <strong>Organization</strong> page to see
                it — every change from here on goes through the same propose-and-approve flow you just used.
              </p>
            ) : (
              <p className="text-sm">
                Proposed. Governance policy requires a human decision on this one — it's waiting in the{" "}
                <strong>Approvals</strong> inbox and applies the moment it's approved.
              </p>
            )}
            {recommendationResult && (
              <div className="rounded-md border p-3 space-y-2 text-sm">
                <p className="font-medium">{recommendationResult.recommendation.title}</p>
                <p>{recommendationResult.recommendation.summary}</p>
                <p className="text-xs text-muted-foreground">{recommendationResult.recommendation.interpretation}</p>
                <a
                  className="text-xs text-[var(--color-steel)] underline"
                  href={recommendationResult.recommendation.citation.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Source: {recommendationResult.recommendation.citation.label}
                </a>
                <p className="text-xs font-medium">Proposed for approval — it will not run unless you approve it.</p>
                {recommendationDecision === "pending" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void decideRecommendation("approve")}>Approve recommendation</Button>
                    <Button size="sm" variant="outline" onClick={() => void decideRecommendation("veto")}>Not now</Button>
                  </div>
                )}
                {recommendationDecision === "approving" && <p className="text-xs text-muted-foreground">Recording your decision through Governance…</p>}
                {recommendationDecision === "approved" && <p className="text-xs text-[var(--color-steel)]">Approved by you and recorded in the append-only governance ledger.</p>}
                {recommendationDecision === "declined" && <p className="text-xs text-muted-foreground">Declined. Nothing was scheduled or run.</p>}
              </div>
            )}
            {!recommendationResult && !learningError && answers.role_model && (
              <p className="text-xs text-muted-foreground">Learning Agent is checking a public source…</p>
            )}
            {learningError && <p className="text-xs text-red-600">{learningError}</p>}
            <DialogFooter>
              <Button onClick={resetAndClose} disabled={submitting}>
                {submitting ? "Finishing research…" : "Done"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
