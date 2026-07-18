/**
 * Settings — PLATFORM-WIDE admin only (ADR-029: platform admin lives here;
 * per-Initiative admin lives at /initiative/:id/control-panel). User-facing
 * vocabulary: Organization (never "Workspace"), Module (never "package"),
 * Initiative / Assistant / Skill / Automation / Workflow. Code identifiers and
 * tRPC procedure names are unchanged.
 *
 * Ten sections (requests.md R-017..R-020). Real data where endpoints exist:
 *   Organization        → workspace.list (name/id; no rename endpoint yet)
 *   Team & Permissions  → workspace.listMembers + workspace.inviteMember
 *   Knowledge           → google.list + integration.list (connected sources)
 *                         + progressive-disclosure link to /knowledge-base
 *   Intelligence        → packages.list (installed Modules)
 *                         + progressive-disclosure link to /intelligence
 *   Governance          → action.listPending (approvals) + ExecutionLedger
 * Notifications / Billing & Plan / Security / API Keys have NO backend yet —
 * they render honest "nothing configured" states, never fabricated toggles.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Settings, Users, CreditCard, Bell, Shield, Key, Building2, Brain, BookOpen, HelpCircle,
  MessageCircle, Keyboard, Zap, ExternalLink, Plus,
} from "lucide-react";
import clsx from "clsx";
import { ExecutionLedger } from "../components/ExecutionLedger";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { MODULE_ROUTES } from "../lib/moduleRoutes";

const navItems = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "learning", label: "Learning", icon: Brain },
  { id: "team", label: "Team & Permissions", icon: Users },
  { id: "knowledge", label: "Knowledge", icon: BookOpen },
  { id: "intelligence", label: "Intelligence", icon: Brain },
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
      .query({ workspaceId: PILOT_WORKSPACE })
      .then(setState)
      .catch((error) => setMessage(String(error)));
  }
  function refreshFlags() {
    trpc.redFlag.listAll
      .query({ workspaceId: PILOT_WORKSPACE, limit: 20 })
      .then(setFlagState)
      .catch((error) => setMessage(String(error)));
  }
  function loadMoreFlags() {
    if (!flagState?.nextCursor) return;
    trpc.redFlag.listAll
      .query({ workspaceId: PILOT_WORKSPACE, limit: 20, cursor: flagState.nextCursor })
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
      workspaceId: PILOT_WORKSPACE,
      memoryId: preference.row.id,
      content: next.trim(),
    });
    setMessage("Preference corrected. The prior value remains only in correction history.");
    refresh();
  }

  async function forget() {
    if (!preference || !window.confirm("Delete this learned preference from Bridge?")) return;
    await trpc.onboarding.forgetMemory.mutate({
      workspaceId: PILOT_WORKSPACE,
      memoryId: preference.row.id,
    });
    setMessage("Preference deleted.");
    refresh();
  }

  async function forgetTrustCapture(memoryId: string) {
    if (!window.confirm("Delete this one-time observation from Bridge?")) return;
    await trpc.onboarding.forgetMemory.mutate({
      workspaceId: PILOT_WORKSPACE,
      memoryId,
    });
    setMessage("One-time observation deleted.");
    refresh();
  }

  async function updateReflection(action: "snooze" | "pause" | "resume" | "skip") {
    if (!reflection) return;
    await trpc.onboarding.setReflection.mutate({
      workspaceId: PILOT_WORKSPACE,
      memoryId: reflection.row.id,
      action,
    });
    setMessage(`Reflection ${action === "resume" ? "resumed" : action === "skip" ? "skipped" : `${action}d`}.`);
    refresh();
  }

  async function clearFlag(flagId: string) {
    await trpc.redFlag.clear.mutate({ workspaceId: PILOT_WORKSPACE, flagId });
    setMessage("Flag cleared.");
    refreshFlags();
  }

  async function reopenFlag(flagId: string) {
    await trpc.redFlag.reopen.mutate({ workspaceId: PILOT_WORKSPACE, flagId });
    setMessage("Flag reopened.");
    refreshFlags();
  }

  async function forgetFlag(flagId: string) {
    if (!window.confirm("Permanently delete this flag's history? Clearing (reversible) is usually the better choice.")) return;
    await trpc.redFlag.forget.mutate({ workspaceId: PILOT_WORKSPACE, flagId });
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
    trpc.workspace.list
      .query()
      .then((rows) => setOrg(rows.find((w) => w.id === PILOT_WORKSPACE) ?? null))
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
            <code className="text-xs bg-[var(--color-surface)] px-2 py-1 rounded text-[var(--color-navy-mid)]">{PILOT_WORKSPACE}</code>
          </div>
          {org !== undefined && (
            <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
              Renaming isn't available yet — there's no update endpoint on the platform.
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
    trpc.workspace.listMembers
      .query({ workspaceId: PILOT_WORKSPACE })
      .then(setMembers)
      .catch((e) => setError(String(e)));
  }
  useEffect(refresh, []);

  async function invite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteNote(null);
    try {
      const res = await trpc.workspace.inviteMember.mutate({ workspaceId: PILOT_WORKSPACE, email: inviteEmail.trim() });
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

function KnowledgeSection() {
  const [google, setGoogle] = useState<GoogleInfo | null>(null);
  const [connected, setConnected] = useState<IntegrationsResult | null>(null);

  useEffect(() => {
    trpc.google.list.query().then(setGoogle).catch(() => {});
    trpc.integration.list.query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 }).then(setConnected).catch(() => {});
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
      <SectionHeader title="Knowledge" desc="What does the platform know? Connected sources feeding your organization's shared knowledge." />

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

type PackagesResult = Awaited<ReturnType<typeof trpc.packages.list.query>>;

function IntelligenceSection() {
  const [result, setResult] = useState<PackagesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.packages.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 })
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Intelligence" desc="What can the platform do with what it knows? Installed Modules and the shared Assistants, Skills, Automations, and Workflows they bring." />

      <Card>
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="font-semibold text-[var(--color-navy)] text-sm">Installed Modules</h3>
          <Link to="/intelligence" className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-steel)] no-underline hover:underline">
            Open Intelligence <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
        {error && <div className="px-6 py-4 text-sm text-red-600 break-words">{error}</div>}
        {!error && result === null && <div className="px-6 py-4 text-sm text-[var(--color-warm-gray)]">Loading…</div>}
        {result !== null && result.items.length === 0 && (
          <div className="px-6 py-8 text-center text-sm text-[var(--color-warm-gray)]">
            No Modules installed yet. Shared Assistants, Skills, Automations, and Workflows will appear here once one is.
          </div>
        )}
        {result !== null && result.items.length > 0 && (
          <div className="divide-y divide-[var(--color-border)]">
            {result.items.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-6 py-3.5">
                <div>
                  <span className="text-sm font-medium text-[var(--color-navy)]">
                    {MODULE_ROUTES[row.packageName]?.label ?? row.packageName}
                  </span>
                  <span className="text-xs text-[var(--color-warm-gray)]"> · v{row.packageVersion}</span>
                </div>
                <span className="text-xs border border-[var(--color-border)] rounded px-1.5 py-0.5 text-[var(--color-navy-mid)]">{row.state}</span>
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
    trpc.action.listPending.query({ workspaceId: PILOT_WORKSPACE, limit: 5, offset: 0 }).then(setPending).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Governance" desc="Every consequential action is proposed, reviewed, and ledgered." />

      <Card>
        <div className="px-6 py-4 flex items-center justify-between">
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
          { icon: BookOpen, title: "Documentation", desc: "Concepts, vocabulary, and how Workflows, Signals, and governance fit together." },
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
  const [activeSection, setActiveSection] = useState("organization");

  const renderContent = () => {
    switch (activeSection) {
      case "organization":
        return <OrganizationSection />;
      case "learning":
        return <LearningSection />;
      case "team":
        return <TeamSection />;
      case "knowledge":
        return <KnowledgeSection />;
      case "intelligence":
        return <IntelligenceSection />;
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
        return (
          <div className="flex flex-col gap-6">
            <SectionHeader title="API Keys" desc="Programmatic access to the platform." />
            <NothingConfigured icon={Key} note="API keys for programmatic access will be provisioned here — key management doesn't exist yet." />
          </div>
        );
      case "help":
        return <HelpSection />;
      default:
        return null;
    }
  };

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

      <div className="flex-1 flex overflow-hidden">
        {/* Left section nav */}
        <div className="w-56 shrink-0 bg-white border-r border-[var(--color-border)] flex flex-col overflow-y-auto">
          <nav className="p-3 flex flex-col gap-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
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
        <div className="flex-1 overflow-y-auto p-8">
          <div className={clsx("mx-auto", activeSection === "governance" ? "max-w-5xl" : "max-w-2xl")}>{renderContent()}</div>
        </div>
      </div>
    </div>
  );
}
