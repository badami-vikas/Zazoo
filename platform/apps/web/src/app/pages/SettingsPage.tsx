/**
 * Settings — platform-wide administration. User-facing copy follows canonical
 * Organization, Module, Agent, Skill, Capability, and Automation vocabulary;
 * legacy route and tRPC identifiers remain time-boxed under VOCAB2.
 *
 * Ten sections (requests.md R-017..R-020). Real data where endpoints exist:
 *   Organization        → organization.list (name/id; onboarding owns rename UX)
 *   Team & Permissions  → organization.listMembers + organization.inviteMember
 *   Sources             → google.list + integration.list (connected sources)
 *   Governance          → action.listPending (approvals) + ExecutionLedger
 *   API Keys            → modelProviderKey.list/save/clear (ADR-181) — model-
 *                         provider secrets in the Local Plane credential vault
 *
 * The former "Capabilities" section moved OUT of Settings and became the
 * top-level Intelligence page (ADR-154); `?section=intelligence` redirects there.
 * Notifications / Billing & Plan / Security have NO backend yet — they render
 * honest "nothing configured" states, never fabricated toggles.
 */
import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import {
  Settings, Users, CreditCard, Bell, Shield, Key, Building2, Sparkles, BookOpen, HelpCircle,
  MessageCircle, Keyboard, Zap, ExternalLink, Plus,
} from "lucide-react";
import clsx from "clsx";
import { ExecutionLedger } from "../components/ExecutionLedger";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";

const navItems = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "learning", label: "Learning", icon: Sparkles },
  { id: "team", label: "Team & Permissions", icon: Users },
  { id: "sources", label: "Sources", icon: BookOpen },
  { id: "governance", label: "Governance", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "billing", label: "Billing & Plan", icon: CreditCard },
  { id: "security", label: "Security", icon: Shield },
  { id: "api", label: "API Keys", icon: Key },
  { id: "help", label: "Help & Support", icon: HelpCircle },
];

type LearningState = Awaited<ReturnType<typeof trpc.onboarding.learningState.query>>;

type RedFlagState = Awaited<ReturnType<typeof trpc.redFlag.listAll.query>>;

function LearningSection() {
  const [state, setState] = useState<LearningState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [flagState, setFlagState] = useState<RedFlagState | null>(null);

  function refresh() {
    trpc.onboarding.learningState
      .query({ organizationId: PILOT_ORGANIZATION })
      .then(setState)
      .catch((error) => setMessage(String(error)));
  }
  function refreshFlags() {
    trpc.redFlag.listAll
      .query({ organizationId: PILOT_ORGANIZATION, limit: 20 })
      .then(setFlagState)
      .catch((error) => setMessage(String(error)));
  }
  function loadMoreFlags() {
    if (!flagState?.nextCursor) return;
    trpc.redFlag.listAll
      .query({ organizationId: PILOT_ORGANIZATION, limit: 20, cursor: flagState.nextCursor })
      .then((next) => setFlagState((prev) => (prev ? { flags: [...prev.flags, ...next.flags], nextCursor: next.nextCursor } : next)))
      .catch((error) => setMessage(String(error)));
  }
  useEffect(refresh, []);
  useEffect(refreshFlags, []);

  const preference = state?.memories.find((item) => item.value.kind === "onboarding_preference");
  const reflection = state?.memories.find((item) => item.value.kind === "reflection_schedule");
  const trustCaptures = state?.memories.filter((item) => item.value.kind === "trust_capture") ?? [];
  const reflectionStatus = reflection?.value.kind === "reflection_schedule" ? reflection.value.status : null;

  async function correct() {
    if (!preference || preference.value.kind !== "onboarding_preference") return;
    const next = window.prompt("What should Bridge remember instead?", preference.value.admiredFor);
    if (!next?.trim()) return;
    await trpc.onboarding.correctMemory.mutate({
      organizationId: PILOT_ORGANIZATION,
      memoryId: preference.row.id,
      content: next.trim(),
    });
    setMessage("Preference corrected. The prior value remains only in correction history.");
    refresh();
  }

  async function forget() {
    if (!preference || !window.confirm("Delete this learned preference from Bridge?")) return;
    await trpc.onboarding.forgetMemory.mutate({
      organizationId: PILOT_ORGANIZATION,
      memoryId: preference.row.id,
    });
    setMessage("Preference deleted.");
    refresh();
  }

  async function forgetTrustCapture(memoryId: string) {
    if (!window.confirm("Delete this one-time observation from Bridge?")) return;
    await trpc.onboarding.forgetMemory.mutate({
      organizationId: PILOT_ORGANIZATION,
      memoryId,
    });
    setMessage("One-time observation deleted.");
    refresh();
  }

  async function updateReflection(action: "snooze" | "pause" | "resume" | "skip") {
    if (!reflection) return;
    await trpc.onboarding.setReflection.mutate({
      organizationId: PILOT_ORGANIZATION,
      memoryId: reflection.row.id,
      action,
    });
    setMessage(`Reflection ${action === "resume" ? "resumed" : action === "skip" ? "skipped" : `${action}d`}.`);
    refresh();
  }

  async function clearFlag(flagId: string) {
    await trpc.redFlag.clear.mutate({ organizationId: PILOT_ORGANIZATION, flagId });
    setMessage("Flag cleared.");
    refreshFlags();
  }

  async function reopenFlag(flagId: string) {
    await trpc.redFlag.reopen.mutate({ organizationId: PILOT_ORGANIZATION, flagId });
    setMessage("Flag reopened.");
    refreshFlags();
  }

  async function forgetFlag(flagId: string) {
    if (!window.confirm("Permanently delete this flag's history? Clearing (reversible) is usually the better choice.")) return;
    await trpc.redFlag.forget.mutate({ organizationId: PILOT_ORGANIZATION, flagId });
    setMessage("Flag permanently deleted.");
    refreshFlags();
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Learning" desc="Inspect and control what Bridge learns from onboarding." />
      <Card>
        <div className="p-6 space-y-3">
          <div className="font-semibold text-sm text-[var(--color-navy)]">Onboarding</div>
          <p className="text-xs text-[var(--color-navy-mid)]">Re-enter the flow at any time. “Start over” clears the draft answers, not your Organization.</p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("bridge:open-onboarding"))}
            className="text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--color-steel)] text-white"
          >
            Re-enter onboarding
          </button>
        </div>
      </Card>
      <Card>
        <div className="p-6 space-y-3">
          <div className="font-semibold text-sm text-[var(--color-navy)]">One-time trust checks</div>
          <p className="text-xs text-[var(--color-navy-mid)]">
            Inspect exactly what the onboarding live check saved. These private Local Plane Memories are never instructions.
          </p>
          {state && trustCaptures.length === 0 && <p className="text-xs text-[var(--color-warm-gray)]">No live check has been saved.</p>}
          {trustCaptures.map((item) => item.value.kind === "trust_capture" && (
            <div key={item.row.id} className="rounded-lg border p-3 space-y-1">
              <p className="text-sm">Foreground app: {item.value.appName}</p>
              <p className="text-xs text-[var(--color-warm-gray)]">
                Captured {new Date(item.value.capturedAt).toLocaleString()} · private · Local Plane · untrusted observation
              </p>
              <button
                type="button"
                onClick={() => void forgetTrustCapture(item.row.id)}
                className="text-xs font-semibold px-3 py-2 rounded-lg border text-red-600"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="p-6 space-y-3">
          <div className="font-semibold text-sm text-[var(--color-navy)]">Learned preferences</div>
          {!state && <p className="text-xs text-[var(--color-warm-gray)]">Loading…</p>}
          {state && !preference && <p className="text-xs text-[var(--color-warm-gray)]">No onboarding preferences saved.</p>}
          {preference?.value.kind === "onboarding_preference" && (
            <>
              <p className="text-sm">You admire {preference.value.figure} for {preference.value.admiredFor}.</p>
              <p className="text-xs text-[var(--color-warm-gray)]">Source: your onboarding answer · private · Local Plane</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => void correct()} className="text-xs font-semibold px-3 py-2 rounded-lg border">Correct</button>
                <button type="button" onClick={() => void forget()} className="text-xs font-semibold px-3 py-2 rounded-lg border text-red-600">Delete</button>
              </div>
            </>
          )}
        </div>
      </Card>
      <CaptureConsentCard />
      <ObservedLearningCard />
      <AutomationDraftsCard />
      <RetrievalQualityCard />
      <Card>
        <div className="p-6 space-y-3">
          <div className="font-semibold text-sm text-[var(--color-navy)]">Day-7 reflection</div>
          <p className="text-xs text-[var(--color-navy-mid)]">
            Why: asking which qualities you value helps future recommendations reflect your choices. You can skip, snooze, or pause it.
          </p>
          {reflection?.value.kind === "reflection_schedule" ? (
            <>
              <p className="text-sm">Status: {reflection.value.status} · {new Date(reflection.value.dueAt).toLocaleString()}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void updateReflection("snooze")} className="text-xs font-semibold px-3 py-2 rounded-lg border">Snooze 1 day</button>
                <button
                  type="button"
                  onClick={() => void updateReflection(reflectionStatus === "paused" || reflectionStatus === "skipped" ? "resume" : "pause")}
                  className="text-xs font-semibold px-3 py-2 rounded-lg border"
                >
                  {reflectionStatus === "paused" || reflectionStatus === "skipped" ? "Schedule in 7 days" : "Pause"}
                </button>
                <button type="button" onClick={() => void updateReflection("skip")} className="text-xs font-semibold px-3 py-2 rounded-lg border">Skip</button>
              </div>
            </>
          ) : (
            <p className="text-xs text-[var(--color-warm-gray)]">Scheduled after you complete role-model learning.</p>
          )}
          {message && <p className="text-xs text-[var(--color-steel)]">{message}</p>}
        </div>
      </Card>
      <Card>
        <div className="p-6 space-y-3">
          <div className="font-semibold text-sm text-[var(--color-navy)]">Red flags</div>
          <p className="text-xs text-[var(--color-navy-mid)]">
            Every scoped correction you've flagged across the platform — the audit evidence for TASK-010's red-flag
            control. Clearing is reversible; deleting is permanent.
          </p>
          {!flagState && <p className="text-xs text-[var(--color-warm-gray)]">Loading…</p>}
          {flagState && flagState.flags.length === 0 && <p className="text-xs text-[var(--color-warm-gray)]">No red flags recorded yet.</p>}
          {flagState?.flags.map(({ row, value }) => (
            <div key={row.id} className="rounded-lg border p-3 space-y-1">
              <p className="text-sm">
                {value.anchor.moduleId}
                {value.anchor.kind === "cell" ? ` · ${value.anchor.databaseId} · ${value.anchor.fieldId}` : ` · ${value.anchor.bulletPath}`}
                {" — \u201c"}{value.renderedValue}{"\u201d"}
              </p>
              {value.reason && <p className="text-xs text-[var(--color-navy-mid)]">Reason: {value.reason}</p>}
              <p className="text-xs text-[var(--color-warm-gray)]">
                {value.status} · learning: {value.learningStatus} · {row.createdBy} · {new Date(row.createdAt).toLocaleString()}
              </p>
              <div className="flex gap-2">
                {value.status === "open" ? (
                  <button type="button" onClick={() => void clearFlag(row.id)} className="text-xs font-semibold px-3 py-2 rounded-lg border">Clear</button>
                ) : (
                  <button type="button" onClick={() => void reopenFlag(row.id)} className="text-xs font-semibold px-3 py-2 rounded-lg border">Reopen</button>
                )}
                <button type="button" onClick={() => void forgetFlag(row.id)} className="text-xs font-semibold px-3 py-2 rounded-lg border text-red-600">Delete</button>
              </div>
            </div>
          ))}
          {flagState?.nextCursor && (
            <button type="button" onClick={loadMoreFlags} className="text-xs font-semibold px-3 py-2 rounded-lg border">Load more</button>
          )}
        </div>
      </Card>
    </div>
  );
}

type LearningSuggestionList = Awaited<ReturnType<typeof trpc.learning.suggestions.list.query>>;
type LearningPreferenceList = Awaited<ReturnType<typeof trpc.learning.preferences.list.query>>;
type PromotionSuggestionList = Awaited<ReturnType<typeof trpc.learning.promotions.list.query>>;
type PromotionDraftList = Awaited<ReturnType<typeof trpc.learning.promotions.drafts.list.query>>;
type RetrievalEvalList = Awaited<ReturnType<typeof trpc.learning.retrieval.evals.query>>;

type CaptureStatus = Awaited<ReturnType<typeof trpc.learning.capture.status.query>>;

const CAPTURE_SOURCE_COPY: Record<
  "chat" | "whatsapp",
  { label: string; description: string }
> = {
  chat: {
    label: "Chat threads",
    description: "Your own sent turns become behavior signals (surface and time of day only — never the message text).",
  },
  whatsapp: {
    label: "WhatsApp messages",
    description: "Your own outbound messages become behavior signals (group/direct and time of day only — never the message body, never anyone else's messages).",
  },
};

/**
 * K2 (TASK-046) — per-source capture consent. Bridge already HOLDS this data
 * locally; learning from it is a NEW use, so each source is an explicit
 * opt-in that defaults OFF, with a kill switch that silences everything
 * without rewriting the per-source choices. Hides itself while the learning
 * flight is off — no dead controls. Every emitted signal is inspectable,
 * deletable Memory (the Observed patterns card below is that surface).
 */
function CaptureConsentCard() {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    trpc.learning.capture.status
      .query({ organizationId: PILOT_ORGANIZATION })
      .then(setStatus)
      .catch(() => setStatus(null)); // unreachable API = render nothing dead
  }
  useEffect(refresh, []);

  if (!status?.enabled) return null;

  async function flipSource(source: "chat" | "whatsapp", enabled: boolean) {
    await trpc.learning.capture.setSource.mutate({ organizationId: PILOT_ORGANIZATION, source, enabled });
    setMessage(
      enabled
        ? `${CAPTURE_SOURCE_COPY[source].label} will now emit behavior signals. Turn it off here at any time.`
        : `${CAPTURE_SOURCE_COPY[source].label} stopped emitting. Already-emitted signals stay deletable below.`,
    );
    refresh();
  }

  async function flipPause(paused: boolean) {
    await trpc.learning.capture.setPaused.mutate({ organizationId: PILOT_ORGANIZATION, paused });
    setMessage(paused ? "All capture paused. Your per-source choices are kept." : "Capture resumed with your previous choices.");
    refresh();
  }

  return (
    <Card>
      <div className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm text-[var(--color-navy)]">Learn from my activity</div>
          <button
            type="button"
            onClick={() => void flipPause(!status.paused)}
            className={`text-xs font-semibold px-3 py-2 rounded-lg border ${status.paused ? "text-red-600" : ""}`}
          >
            {status.paused ? "Paused — resume" : "Pause all"}
          </button>
        </div>
        <p className="text-xs text-[var(--color-navy-mid)]">
          Off by default. Each source is a separate consent; turning one on lets Bridge notice YOUR OWN rhythms in data
          it already holds locally. Signals are envelope-only (never message text), private, Local Plane, and deletable.
        </p>
        {(["chat", "whatsapp"] as const).map((source) => {
          const row = status.sources[source];
          return (
            <div key={source} className="rounded-lg border p-3 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">{CAPTURE_SOURCE_COPY[source].label}</p>
                <p className="text-xs text-[var(--color-warm-gray)]">{CAPTURE_SOURCE_COPY[source].description}</p>
                {row.changedAt && (
                  <p className="text-xs text-[var(--color-warm-gray)]">
                    {row.enabled ? "Enabled" : "Disabled"} {new Date(row.changedAt).toLocaleString()} by {row.changedBy}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void flipSource(source, !row.enabled)}
                disabled={status.paused}
                className={`text-xs font-semibold px-3 py-2 rounded-lg shrink-0 ${
                  row.enabled ? "bg-[var(--color-steel)] text-white" : "border"
                } ${status.paused ? "opacity-50" : ""}`}
              >
                {row.enabled ? "On" : "Off"}
              </button>
            </div>
          );
        })}
        {message && <p className="text-xs text-[var(--color-steel)]">{message}</p>}
      </div>
    </Card>
  );
}

/**
 * TASK-032 — observed-learning review: the "your Egg noticed a pattern — keep
 * it?" moment. Suggested-then-accepted stays Human-gated here: Accept is the
 * ONLY path that turns a proposal into a learned preference. The whole card
 * hides itself while the learning observation flight is off
 * (`learning.status` → enabled:false) — no dead controls, per UI honesty
 * canon. Every stored row remains inspectable/deletable.
 */
function ObservedLearningCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [suggestions, setSuggestions] = useState<LearningSuggestionList | null>(null);
  const [preferences, setPreferences] = useState<LearningPreferenceList | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    trpc.learning.status
      .query({ organizationId: PILOT_ORGANIZATION })
      .then((status) => {
        setEnabled(status.enabled);
        if (!status.enabled) return;
        trpc.learning.suggestions.list
          .query({ organizationId: PILOT_ORGANIZATION, status: "proposed" })
          .then(setSuggestions)
          .catch((error) => setMessage(String(error)));
        trpc.learning.preferences.list
          .query({ organizationId: PILOT_ORGANIZATION })
          .then(setPreferences)
          .catch((error) => setMessage(String(error)));
      })
      .catch(() => setEnabled(false)); // unreachable API = treat as off, render nothing dead
  }
  useEffect(refresh, []);

  // Flight off (or still resolving): render nothing — never dead controls.
  if (enabled !== true) return null;

  async function digest() {
    const result = await trpc.learning.digest.mutate({ organizationId: PILOT_ORGANIZATION });
    setMessage(
      result.suggestions.length === 0
        ? "No new repeated patterns found in your recent decisions."
        : `Found ${result.suggestions.length} new pattern${result.suggestions.length === 1 ? "" : "s"} to review.`,
    );
    refresh();
  }

  async function accept(suggestionMemoryId: string) {
    await trpc.learning.suggestions.accept.mutate({ organizationId: PILOT_ORGANIZATION, suggestionMemoryId });
    setMessage("Saved as a learned preference. It now informs agent context; you can delete it below at any time.");
    refresh();
  }

  async function reject(suggestionMemoryId: string) {
    await trpc.learning.suggestions.reject.mutate({ organizationId: PILOT_ORGANIZATION, suggestionMemoryId });
    setMessage("Dismissed. This pattern will not be suggested again.");
    refresh();
  }

  async function forgetPreference(memoryId: string) {
    if (!window.confirm("Delete this learned preference from Bridge?")) return;
    await trpc.onboarding.forgetMemory.mutate({ organizationId: PILOT_ORGANIZATION, memoryId });
    setMessage("Learned preference deleted.");
    refresh();
  }

  return (
    <Card>
      <div className="p-6 space-y-3">
        <div className="font-semibold text-sm text-[var(--color-navy)]">Observed patterns</div>
        <p className="text-xs text-[var(--color-navy-mid)]">
          Bridge notices when your explicit decisions repeat (for example, dismissing deals in the same industry) and
          asks before remembering anything. Nothing is learned without your acceptance; everything learned is private,
          Local Plane, and deletable.
        </p>
        <button type="button" onClick={() => void digest()} className="text-xs font-semibold px-3 py-2 rounded-lg border">
          Check for new patterns
        </button>
        {suggestions && suggestions.suggestions.length === 0 && (
          <p className="text-xs text-[var(--color-warm-gray)]">No patterns are waiting for review.</p>
        )}
        {suggestions?.suggestions.map((suggestion) => (
          <div key={suggestion.memoryId} className="rounded-lg border p-3 space-y-1">
            <p className="text-sm">{suggestion.suggestedText}</p>
            <p className="text-xs text-[var(--color-warm-gray)]">
              Evidence: {suggestion.pattern.evidenceSignalIds.length} of your own {suggestion.pattern.action} decisions ·
              private · Local Plane
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void accept(suggestion.memoryId)}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--color-steel)] text-white"
              >
                Remember this
              </button>
              <button
                type="button"
                onClick={() => void reject(suggestion.memoryId)}
                className="text-xs font-semibold px-3 py-2 rounded-lg border"
              >
                No, dismiss
              </button>
            </div>
          </div>
        ))}
        {preferences && preferences.preferences.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="font-semibold text-xs text-[var(--color-navy)]">Accepted from observed patterns</div>
            {preferences.preferences.map((preference) => (
              <div key={preference.memoryId} className="rounded-lg border p-3 space-y-1">
                <p className="text-sm">{preference.statement}</p>
                <p className="text-xs text-[var(--color-warm-gray)]">
                  Source: your accepted suggestion · {preference.provenance.evidenceSignalIds.length} evidence decisions ·
                  private · Local Plane
                </p>
                <button
                  type="button"
                  onClick={() => void forgetPreference(preference.memoryId)}
                  className="text-xs font-semibold px-3 py-2 rounded-lg border text-red-600"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
        {message && <p className="text-xs text-[var(--color-steel)]">{message}</p>}
      </div>
    </Card>
  );
}

type ModelProviderKeyList = Awaited<ReturnType<typeof trpc.modelProviderKey.list.query>>;

/**
 * Settings → API Keys (ADR-181). Model-provider keys only — there is still no
 * inbound Bridge API key to provision, and this section does not pretend
 * otherwise.
 *
 * Honesty rules this component exists to keep (AP-021):
 *  - The input is write-only. A saved key is NEVER read back, not even masked;
 *    the row reports "Stored" plus when, and re-entering replaces it.
 *  - Saving does not activate. The provider is constructed from the vault when
 *    the API process boots, so a saved-but-unregistered key says exactly that
 *    and asks for a restart, rather than showing a green "connected" state.
 *  - When the API is the public cloud shell it cannot hold a key at all; the
 *    section says so instead of offering a control that will fail.
 */
function ApiKeysSection() {
  const [state, setState] = useState<ModelProviderKeyList | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function refresh() {
    trpc.modelProviderKey.list
      .query({ organizationId: PILOT_ORGANIZATION })
      .then((next) => {
        setState(next);
        setUnavailable(null);
      })
      .catch(() =>
        setUnavailable(
          "This Bridge API cannot manage model-provider keys. Keys are held in the Local Plane credential vault, which only the Bridge desktop app has.",
        ),
      );
  }
  useEffect(refresh, []);

  async function save(providerId: string, label: string) {
    const apiKey = drafts[providerId]?.trim();
    if (!apiKey) return;
    setBusy(providerId);
    setNote(null);
    try {
      const result = await trpc.modelProviderKey.save.mutate({
        organizationId: PILOT_ORGANIZATION,
        providerId,
        apiKey,
      });
      setDrafts((prev) => ({ ...prev, [providerId]: "" }));
      setNote(
        result.activation === "already_active"
          ? `${label} key saved to the Local Plane vault. ${label} is already running in this process; the saved key takes over at the next restart.`
          : `${label} key saved to the Local Plane vault. Restart Bridge to activate ${label} — this running process built its providers at boot and does not pick the key up live.`,
      );
      refresh();
    } catch (error) {
      setNote(String(error));
    } finally {
      setBusy(null);
    }
  }

  async function clear(providerId: string, label: string) {
    if (!window.confirm(`Delete the stored ${label} API key from this machine's credential vault?`)) return;
    setBusy(providerId);
    setNote(null);
    try {
      const result = await trpc.modelProviderKey.clear.mutate({
        organizationId: PILOT_ORGANIZATION,
        providerId,
      });
      setNote(
        result.stillActive
          ? `${label} key deleted from the vault. ${label} stays active until Bridge restarts.`
          : `${label} key deleted from the vault.`,
      );
      refresh();
    } catch (error) {
      setNote(String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="API Keys" desc="Model-provider credentials for this Organization." />

      {unavailable && <NothingConfigured icon={Key} note={unavailable} />}

      {state && !state.storageAvailable && (
        <NothingConfigured
          icon={Key}
          note="Keys are entered on the Bridge desktop app. The public cloud API never holds a model-provider secret."
        />
      )}

      {state?.storageAvailable && (
        <>
          <p className="text-xs leading-relaxed" style={{ color: "var(--color-warm-gray)" }}>
            A key you enter here is written to this machine's credential vault — the operating system
            keyring, or an encrypted file under your Bridge local directory. It stays on the Local
            Plane: it is never stored in the database, never sent to Bridge Cloud, never written to a
            log, and never returned to this page again. Deleting it here deletes it from the vault.
          </p>

          {state.providers.map((provider) => (
            <Card key={provider.providerId}>
              <div className="p-6 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold text-sm text-[var(--color-navy)]">{provider.label}</div>
                    <p className="text-xs text-[var(--color-navy-mid)] mt-0.5">{provider.description}</p>
                  </div>
                  <span className="text-xs shrink-0 text-[var(--color-warm-gray)]">
                    {provider.active ? "Active" : provider.configured ? "Saved · inactive" : "Not configured"}
                  </span>
                </div>

                <p className="text-xs text-[var(--color-warm-gray)]">
                  {provider.fromEnvironment
                    ? `This process was started with ${provider.envVar} set, and that environment value is what is running. A key saved here is used only when ${provider.envVar} is unset at the next start.`
                    : provider.configured && provider.active
                      ? `Stored ${provider.updatedAt ? new Date(provider.updatedAt).toLocaleString() : ""} and registered in this process.`
                      : provider.configured
                        ? `Stored ${provider.updatedAt ? new Date(provider.updatedAt).toLocaleString() : ""}. Not registered in this process — restart Bridge to activate it.`
                        : `No key stored. ${provider.label} is not available to Agents until one is saved and Bridge restarts.`}
                </p>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={drafts[provider.providerId] ?? ""}
                    onChange={(event) =>
                      setDrafts((prev) => ({ ...prev, [provider.providerId]: event.target.value }))
                    }
                    placeholder={provider.configured ? "Enter a new key to replace the stored one" : `${provider.label} API key`}
                    aria-label={`${provider.label} API key`}
                    className="flex-1 px-4 py-2.5 border border-[var(--color-border)] rounded-lg text-sm font-mono focus:border-[var(--color-steel)] focus:ring-2 focus:ring-[var(--color-steel)]/10 outline-none transition-all bg-[var(--color-surface)] focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => void save(provider.providerId, provider.label)}
                    disabled={busy === provider.providerId || !drafts[provider.providerId]?.trim()}
                    className="text-xs font-semibold px-3 py-2.5 rounded-lg bg-[var(--color-steel)] text-white disabled:opacity-50"
                  >
                    {busy === provider.providerId ? "Saving…" : "Save key"}
                  </button>
                  {provider.configured && (
                    <button
                      type="button"
                      onClick={() => void clear(provider.providerId, provider.label)}
                      disabled={busy === provider.providerId}
                      className="text-xs font-semibold px-3 py-2.5 rounded-lg border text-red-600 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}

          {note && <p className="text-xs text-[var(--color-steel)] break-words">{note}</p>}

          <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
            Keys for calling <em>into</em> Bridge from your own code aren't issued yet — there's no
            inbound API-key backend, so nothing is provisioned here.
          </p>
        </>
      )}
    </div>
  );
}

/** Draft editor for repeated-behavior Automation promotions (ADR-172/173).
 * Suggested-then-accepted throughout: proposals only become drafts on
 * explicit acceptance, a draft NEVER runs (the executor cannot even load
 * it), and activation is a separate explicit step that requires real
 * governed steps. Flight-gated like every learning surface — renders
 * nothing while the flight is off or the API is unreachable. */
function AutomationDraftsCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [proposals, setProposals] = useState<PromotionSuggestionList | null>(null);
  const [drafts, setDrafts] = useState<PromotionDraftList | null>(null);
  const [stepSkill, setStepSkill] = useState<Record<string, string>>({});
  const [stepAction, setStepAction] = useState<Record<string, string>>({});
  const [stepResource, setStepResource] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    trpc.learning.status
      .query({ organizationId: PILOT_ORGANIZATION })
      .then((status) => {
        setEnabled(status.enabled);
        if (!status.enabled) return;
        trpc.learning.promotions.list
          .query({ organizationId: PILOT_ORGANIZATION, status: "proposed" })
          .then(setProposals)
          .catch((error) => setMessage(String(error)));
        trpc.learning.promotions.drafts.list
          .query({ organizationId: PILOT_ORGANIZATION })
          .then(setDrafts)
          .catch((error) => setMessage(String(error)));
      })
      .catch(() => setEnabled(false)); // unreachable API = treat as off, render nothing dead
  }
  useEffect(refresh, []);

  if (enabled !== true) return null;

  async function propose() {
    const result = await trpc.learning.promotions.propose.mutate({ organizationId: PILOT_ORGANIZATION });
    setMessage(
      result.suggestions.length === 0
        ? "No heavily repeated behavior found — Automation candidates need more repetitions than preferences."
        : `Found ${result.suggestions.length} candidate${result.suggestions.length === 1 ? "" : "s"} to review.`,
    );
    refresh();
  }

  async function acceptProposal(suggestionMemoryId: string) {
    const result = await trpc.learning.promotions.accept.mutate({ organizationId: PILOT_ORGANIZATION, suggestionMemoryId });
    setMessage(`Draft "${result.name}" created. It never runs until you give it steps and explicitly activate it.`);
    refresh();
  }

  async function rejectProposal(suggestionMemoryId: string) {
    await trpc.learning.promotions.reject.mutate({ organizationId: PILOT_ORGANIZATION, suggestionMemoryId });
    setMessage("Dismissed. This behavior will not be proposed as an Automation again.");
    refresh();
  }

  async function addStep(automationId: string, existingSteps: PromotionDraftList["drafts"][number]["steps"]) {
    const skill = (stepSkill[automationId] ?? "").trim();
    const resourceType = (stepResource[automationId] ?? "").trim();
    if (!skill || !resourceType) {
      setMessage("A step needs a Skill id and a resource type.");
      return;
    }
    try {
      await trpc.learning.promotions.drafts.update.mutate({
        organizationId: PILOT_ORGANIZATION,
        automationId,
        steps: [
          ...existingSteps.map((step) => ({ ...step })),
          { skill, action: stepAction[automationId] ?? "write", resourceType },
        ],
      });
      setStepSkill((previous) => ({ ...previous, [automationId]: "" }));
      setMessage("Step added. The draft still never runs until you activate it.");
    } catch (error) {
      setMessage(String(error)); // server refusal (unknown skill, invalid step) surfaced verbatim
    }
    refresh();
  }

  async function activate(automationId: string) {
    if (!window.confirm("Activate this Automation? It becomes startable and every run passes Bridge's governance gates.")) {
      return;
    }
    try {
      const result = await trpc.learning.promotions.drafts.activate.mutate({
        organizationId: PILOT_ORGANIZATION,
        automationId,
      });
      setMessage(`Automation ${result.automationId} is now active.`);
    } catch (error) {
      setMessage(String(error)); // typed refusals (no steps, unregistered skill) surfaced verbatim
    }
    refresh();
  }

  return (
    <Card>
      <div className="p-6 space-y-3">
        <div className="font-semibold text-sm text-[var(--color-navy)]">Automation drafts</div>
        <p className="text-xs text-[var(--color-navy-mid)]">
          When you repeat the same decision many times, Bridge can propose drafting an Automation. A draft never runs:
          it waits for your review, needs real governed steps, and only your explicit activation makes it startable —
          after which every run still passes Bridge&apos;s governance gates.
        </p>
        <button type="button" onClick={() => void propose()} className="text-xs font-semibold px-3 py-2 rounded-lg border">
          Check for automation candidates
        </button>
        {proposals && proposals.suggestions.length === 0 && (
          <p className="text-xs text-[var(--color-warm-gray)]">No candidates are waiting for review.</p>
        )}
        {proposals?.suggestions.map((proposal) => (
          <div key={proposal.memoryId} className="rounded-lg border p-3 space-y-1">
            <p className="text-sm">{proposal.suggestedText}</p>
            <p className="text-xs text-[var(--color-warm-gray)]">
              Evidence: {proposal.pattern.evidenceSignalIds.length} of your own {proposal.pattern.action} decisions ·
              private · Local Plane
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void acceptProposal(proposal.memoryId)}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--color-steel)] text-white"
              >
                Draft an Automation
              </button>
              <button
                type="button"
                onClick={() => void rejectProposal(proposal.memoryId)}
                className="text-xs font-semibold px-3 py-2 rounded-lg border"
              >
                No, dismiss
              </button>
            </div>
          </div>
        ))}
        {drafts && drafts.drafts.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="font-semibold text-xs text-[var(--color-navy)]">Drafts awaiting steps and activation</div>
            {drafts.drafts.map((draft) => (
              <div key={draft.id} className="rounded-lg border p-3 space-y-2">
                <p className="text-sm">{draft.name}</p>
                <p className="text-xs text-[var(--color-warm-gray)]">
                  Status: draft — never runs · {draft.steps.length === 0 ? "no steps yet" : `${draft.steps.length} step${draft.steps.length === 1 ? "" : "s"}`}
                </p>
                {draft.steps.map((step, index) => (
                  <p key={`${draft.id}-step-${index}`} className="text-xs font-mono text-[var(--color-navy-mid)]">
                    {index + 1}. {step.skill} · {step.action} · {step.resourceType}
                  </p>
                ))}
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    placeholder="Skill id (e.g. learning.observationDigest)"
                    value={stepSkill[draft.id] ?? ""}
                    onChange={(event) => setStepSkill((previous) => ({ ...previous, [draft.id]: event.target.value }))}
                    className="text-xs px-2 py-2 rounded-lg border flex-1 min-w-[16rem]"
                  />
                  <select
                    value={stepAction[draft.id] ?? "write"}
                    onChange={(event) => setStepAction((previous) => ({ ...previous, [draft.id]: event.target.value }))}
                    className="text-xs px-2 py-2 rounded-lg border"
                  >
                    <option value="read">read</option>
                    <option value="write">write</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Resource type (e.g. signal)"
                    value={stepResource[draft.id] ?? ""}
                    onChange={(event) => setStepResource((previous) => ({ ...previous, [draft.id]: event.target.value }))}
                    className="text-xs px-2 py-2 rounded-lg border w-40"
                  />
                  <button
                    type="button"
                    onClick={() => void addStep(draft.id, draft.steps)}
                    className="text-xs font-semibold px-3 py-2 rounded-lg border"
                  >
                    Add step
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void activate(draft.id)}
                  disabled={draft.steps.length === 0}
                  className="text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--color-steel)] text-white disabled:opacity-40"
                >
                  Activate
                </button>
              </div>
            ))}
          </div>
        )}
        {message && <p className="text-xs text-[var(--color-steel)]">{message}</p>}
      </div>
    </Card>
  );
}

/** Retrieval quality read-out (ADR-174). The metric label is NON-NEGOTIABLE
 * honesty: these are self-retrieval consistency numbers — can Bridge find
 * your own notes again — never human-judged relevance, and the card says so
 * verbatim from the API's own metricNote. */
function RetrievalQualityCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [evals, setEvals] = useState<RetrievalEvalList | null>(null);

  useEffect(() => {
    trpc.learning.retrieval.status
      .query({ organizationId: PILOT_ORGANIZATION })
      .then((status) => {
        setEnabled(status.enabled);
        if (!status.enabled) return;
        trpc.learning.retrieval.evals
          .query({ organizationId: PILOT_ORGANIZATION })
          .then(setEvals)
          .catch(() => setEvals(null));
      })
      .catch(() => setEnabled(false)); // unreachable API = treat as off, render nothing dead
  }, []);

  if (enabled !== true) return null;

  return (
    <Card>
      <div className="p-6 space-y-3">
        <div className="font-semibold text-sm text-[var(--color-navy)]">Retrieval quality</div>
        <p className="text-xs text-[var(--color-navy-mid)]">
          {evals?.metricNote ??
            "Self-retrieval consistency: how reliably retrieval finds this organization's own notes again. Not human-judged relevance."}
        </p>
        {(!evals || evals.runs.length === 0) && (
          <p className="text-xs text-[var(--color-warm-gray)]">
            No eval runs recorded yet. Bridge scores its own retrieval every few hours while retrieval fusion is on.
          </p>
        )}
        {evals?.runs.map((run) => (
          <div key={run.runId} className="rounded-lg border p-3 space-y-1">
            <p className="text-sm">
              Recall {Math.round(run.recallAtK * 100)}% · Precision {Math.round(run.precisionAtK * 100)}% · MRR{" "}
              {run.mrr.toFixed(2)}
            </p>
            <p className="text-xs text-[var(--color-warm-gray)]">
              {new Date(run.startedAt).toLocaleString()} · {run.cases} self-retrieval cases · space {run.embeddingModel} ·
              dataset {run.datasetId}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--color-navy)] mb-1">{title}</h2>
      <p className="text-sm text-[var(--color-navy-mid)]">{desc}</p>
    </div>
  );
}

/** Honest minimal empty state for sections with no backend yet. */
function NothingConfigured({ icon: Icon, note }: { icon: typeof Bell; note: string }) {
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center border border-dashed rounded-xl" style={{ borderColor: "var(--color-border)" }}>
      <Icon className="w-8 h-8" style={{ color: "var(--color-warm-gray)" }} />
      <div className="text-sm font-semibold text-[var(--color-navy)]">Nothing configured yet</div>
      <p className="text-xs max-w-sm" style={{ color: "var(--color-warm-gray)" }}>{note}</p>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden", className)}>{children}</div>;
}

function OrganizationSection() {
  const [org, setOrg] = useState<{ id: string; name: string; createdAt: string } | null | undefined>(undefined);

  useEffect(() => {
    trpc.organization.list
      .query()
      .then((rows) => setOrg(rows.find((w) => w.id === PILOT_ORGANIZATION) ?? null))
      .catch(() => setOrg(null));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Organization" desc="Your organization's identity across the platform." />
      <Card>
        <div className="p-6 flex flex-col gap-5">
          <div>
            <div className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wider mb-1">Name</div>
            <div className="text-sm font-medium text-[var(--color-navy)]">
              {org === undefined ? "Loading…" : org === null ? "Unnamed organization" : org.name}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wider mb-1">Organization ID</div>
            <code className="text-xs bg-[var(--color-surface)] px-2 py-1 rounded text-[var(--color-navy-mid)]">{PILOT_ORGANIZATION}</code>
          </div>
          {org !== undefined && (
            <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
              To change this name, open Learning and re-enter Onboarding.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function TeamSection() {
  const [members, setMembers] = useState<{ userId: string; email: string; name: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteNote, setInviteNote] = useState<string | null>(null);

  function refresh() {
    trpc.organization.listMembers
      .query({ organizationId: PILOT_ORGANIZATION })
      .then(setMembers)
      .catch((e) => setError(String(e)));
  }
  useEffect(refresh, []);

  async function invite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteNote(null);
    try {
      const res = await trpc.organization.inviteMember.mutate({ organizationId: PILOT_ORGANIZATION, email: inviteEmail.trim() });
      setInviteNote(`Invited ${res.email}.`);
      setInviteEmail("");
      refresh();
    } catch (e) {
      setInviteNote(String(e));
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Team & Permissions" desc={`${members?.length ?? "…"} members in your organization.`} />

      <Card>
        <div className="p-5 flex items-center gap-3">
          <input
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="teammate@company.com"
            type="email"
            className="flex-1 px-4 py-2.5 border border-[var(--color-border)] rounded-lg text-sm focus:border-[var(--color-steel)] focus:ring-2 focus:ring-[var(--color-steel)]/10 outline-none transition-all bg-[var(--color-surface)] focus:bg-white"
          />
          <button
            onClick={() => void invite()}
            disabled={inviting || !inviteEmail.trim()}
            className="flex items-center gap-1.5 bg-[var(--color-steel)] text-white text-xs font-semibold px-3 py-2.5 rounded-lg hover:bg-[var(--color-navy-mid)] transition-colors shadow-sm disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Invite
          </button>
        </div>
        {inviteNote && <div className="px-5 pb-4 text-xs text-[var(--color-navy-mid)] break-words">{inviteNote}</div>}
      </Card>

      {error && <div className="text-sm text-red-600 break-words">{error}</div>}
      <Card>
        <table className="w-full text-sm text-left">
          <thead className="bg-[var(--color-surface)] border-b border-[var(--color-border)]">
            <tr>
              <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider">Member</th>
              <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider">Email</th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => (
              <tr key={m.userId} className="border-b border-[var(--color-border)] last:border-b-0">
                <td className="px-5 py-3.5 font-medium text-[var(--color-navy)]">{m.name ?? "—"}</td>
                <td className="px-5 py-3.5 text-[var(--color-navy-mid)]">{m.email}</td>
              </tr>
            ))}
            {members !== null && members.length === 0 && (
              <tr>
                <td colSpan={2} className="px-5 py-8 text-center text-sm text-[var(--color-warm-gray)]">
                  No team members yet. Invite someone to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
        Roles and per-member permissions aren't configurable yet — everyone invited is a member.
      </p>
    </div>
  );
}

type GoogleInfo = Awaited<ReturnType<typeof trpc.google.list.query>>;
type IntegrationsResult = Awaited<ReturnType<typeof trpc.integration.list.query>>;

function SourcesSection() {
  const [google, setGoogle] = useState<GoogleInfo | null>(null);
  const [connected, setConnected] = useState<IntegrationsResult | null>(null);

  useEffect(() => {
    trpc.google.list.query().then(setGoogle).catch(() => {});
    trpc.integration.list.query({ organizationId: PILOT_ORGANIZATION, limit: 50, offset: 0 }).then(setConnected).catch(() => {});
  }, []);

  const sources: { name: string; status: string; to?: string }[] = [
    ...(google
      ? google.surfaces.map((s) => ({
          name: s.name,
          status: google.connection.connected ? "connected" : "not connected",
          to: "/integrations/google",
        }))
      : []),
    ...(connected?.items.map((i) => ({ name: i.provider, status: i.status })) ?? []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Sources" desc="Connected sources Bridge can use for your Organization." />

      <Card>
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="font-semibold text-[var(--color-navy)] text-sm">Connected sources</h3>
          <Link to="/module/relationship/signals" className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-steel)] no-underline hover:underline">
            Open Relationship <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
        {sources.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-warm-gray)]">
            No sources connected yet. Collections, documents, and connected repositories will appear here.
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {sources.map((s) => (
              <div key={s.name} className="flex items-center justify-between px-6 py-3.5">
                <span className="text-sm font-medium text-[var(--color-navy)]">{s.name}</span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-[var(--color-warm-gray)]">{s.status}</span>
                  {s.to && (
                    <Link to={s.to} className="text-xs font-semibold text-[var(--color-steel)] no-underline hover:underline">
                      Open
                    </Link>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

type PendingResult = Awaited<ReturnType<typeof trpc.action.listPending.query>>;

function GovernanceSection() {
  const [pending, setPending] = useState<PendingResult | null>(null);

  useEffect(() => {
    trpc.action.listPending.query({ organizationId: PILOT_ORGANIZATION, limit: 5, offset: 0 }).then(setPending).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Governance" desc="Every consequential action is proposed, reviewed, and ledgered." />

      <Card>
        <div className="px-4 py-4 sm:px-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-[var(--color-navy)]">Pending approvals</div>
            <div className="text-xs text-[var(--color-warm-gray)] mt-0.5">
              {pending === null ? "Loading…" : `${pending.total} awaiting a human decision`}
            </div>
          </div>
          <Link to="/approvals" className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-steel)] no-underline hover:underline">
            Open Approvals <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </Card>

      <ExecutionLedger />
    </div>
  );
}

function HelpSection() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Help & Support" desc="Guides, shortcuts, and a direct line to the Bridge team." />

      <div className="grid sm:grid-cols-2 gap-4">
        {[
          { icon: BookOpen, title: "Documentation", desc: "Concepts, vocabulary, and how Automations, Signals, and governance fit together." },
          { icon: MessageCircle, title: "Contact support", desc: "Reach the Bridge team for setup, billing, or anything urgent." },
          { icon: Keyboard, title: "Keyboard shortcuts", desc: "Move faster across the network, work, and approvals surfaces." },
          { icon: Zap, title: "What's new", desc: "Recent releases — approvals inbox, execution ledger, two-tier profiles." },
        ].map((card) => (
          <div key={card.title} className="flex flex-col gap-3 p-5 bg-white border border-[var(--color-border)] rounded-xl shadow-sm">
            <div className="w-9 h-9 rounded-lg bg-[var(--color-steel)]/10 flex items-center justify-center">
              <card.icon className="w-4 h-4 text-[var(--color-steel)]" />
            </div>
            <div>
              <div className="font-semibold text-[var(--color-navy)] text-sm mb-0.5">{card.title}</div>
              <div className="text-xs text-[var(--color-navy-mid)] leading-relaxed">{card.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 p-5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl">
        <div className="w-10 h-10 rounded-xl bg-[var(--color-navy)] flex items-center justify-center shrink-0">
          <HelpCircle className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-[var(--color-navy)] text-sm">Still stuck?</div>
          <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">Bridge AI can answer most product questions from the assistant panel on the right.</div>
        </div>
        <span className="text-xs font-medium text-[var(--color-warm-gray)]">support@bridge.ai</span>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Deep-linkable section (e.g. /settings?section=governance).
  // Falls back to Organization for an unknown/missing param.
  const requestedSection = searchParams.get("section");
  // ADR-154 — "Capabilities" left Settings and became the top-level Intelligence
  // page. Honour the old deep link rather than silently dropping callers onto
  // Organization. Evaluated as a flag, not an early return: the hooks below must
  // stay unconditional.
  const redirectToIntelligence = requestedSection === "intelligence";
  const initialSection = navItems.some((item) => item.id === requestedSection)
    ? (requestedSection as string)
    : "organization";
  const [activeSection, setActiveSection] = useState(initialSection);

  // Keep the active section in sync if the URL param changes (e.g. clicking the
  // same left-nav entry again, or navigating between deep links).
  useEffect(() => {
    if (requestedSection && navItems.some((item) => item.id === requestedSection)) {
      setActiveSection(requestedSection);
    }
  }, [requestedSection]);

  function changeSection(id: string) {
    setActiveSection(id);
    const params = new URLSearchParams(searchParams);
    params.set("section", id);
    setSearchParams(params, { replace: true });
  }

  const renderContent = () => {
    switch (activeSection) {
      case "organization":
        return <OrganizationSection />;
      case "learning":
        return <LearningSection />;
      case "team":
        return <TeamSection />;
      case "sources":
        return <SourcesSection />;
      case "governance":
        return <GovernanceSection />;
      case "notifications":
        return (
          <div className="flex flex-col gap-6">
            <SectionHeader title="Notifications" desc="How and when the platform notifies your organization." />
            <NothingConfigured icon={Bell} note="Notification preferences will live here — nothing is configurable yet because no notification backend exists." />
          </div>
        );
      case "billing":
        return (
          <div className="flex flex-col gap-6">
            <SectionHeader title="Billing & Plan" desc="Your subscription and payment details." />
            <NothingConfigured icon={CreditCard} note="Your plan, payment method, and invoices will appear here once a billing provider is connected." />
          </div>
        );
      case "security":
        return (
          <div className="flex flex-col gap-6">
            <SectionHeader title="Security" desc="Authentication and access controls for your organization." />
            <NothingConfigured icon={Shield} note="Two-factor enforcement, SSO, and session management will live here — none are configurable yet." />
          </div>
        );
      case "api":
        return <ApiKeysSection />;
      case "help":
        return <HelpSection />;
      default:
        return null;
    }
  };

  if (redirectToIntelligence) {
    return <Navigate to="/intelligence" replace />;
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FAF9F5] overflow-hidden">
      {/* Page Header */}
      <div className="h-14 flex items-center px-6 bg-white border-b border-[var(--color-border)] shrink-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-surface)] flex items-center justify-center">
            <Settings className="w-4 h-4 text-[var(--color-navy-mid)]" />
          </div>
          <div>
            <h1 className="font-bold text-[var(--color-navy)] text-sm leading-tight">Settings</h1>
            <p className="text-xs text-[var(--color-navy-mid)]">Platform-wide administration for your organization</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col sm:flex-row overflow-hidden">
        <div className="sm:hidden shrink-0 bg-white border-b border-[var(--color-border)] p-3">
          <label htmlFor="settings-section" className="sr-only">Settings section</label>
          <select
            id="settings-section"
            value={activeSection}
            onChange={(event) => changeSection(event.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm font-medium text-[var(--color-navy)]"
          >
            {navItems.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>

        {/* Left section nav */}
        <div className="hidden sm:flex w-56 shrink-0 bg-white border-r border-[var(--color-border)] flex-col overflow-y-auto">
          <nav className="p-3 flex flex-col gap-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => changeSection(item.id)}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left",
                  activeSection === item.id
                    ? "bg-[var(--color-steel)]/10 text-[var(--color-steel)]"
                    : "text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)] hover:text-[var(--color-navy)]",
                )}
              >
                <item.icon className={clsx("w-4 h-4 shrink-0", activeSection === item.id ? "text-[var(--color-steel)]" : "text-[var(--color-warm-gray)]")} />
                {item.label}
                {activeSection === item.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--color-steel)]" />}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-8">
          <div className={clsx("mx-auto", activeSection === "governance" ? "max-w-5xl" : "max-w-2xl")}>{renderContent()}</div>
        </div>
      </div>
    </div>
  );
}
