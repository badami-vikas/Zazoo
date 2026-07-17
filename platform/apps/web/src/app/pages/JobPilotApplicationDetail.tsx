import { TRPCClientError } from '@trpc/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  AlertTriangle, ArrowLeft, Bot, BriefcaseBusiness, Check, CheckCircle2, ChevronDown,
  ChevronRight, ChevronUp, Clipboard, ExternalLink, FileCheck2, FileText, Flag, Lightbulb,
  LockKeyhole, MessageSquareText, Quote, ShieldCheck, ShieldAlert, Sparkles, Target, Users, XCircle,
} from 'lucide-react';
import { BCG_APPLICATION, artifactById, type ApplicationArtifact, type ArtifactStatus } from '../data/bcg-application';
import {
  loadStoredCultureResearchState,
  saveStoredCultureResearchState,
  clearStoredCultureResearchState,
  deriveBoundedArtifactFactClaim,
  isArtifactUsable,
  type StoredCultureResearchState,
} from '../data/culture-research-client';
import { EditableField } from '../components/shared/EditableField';
import { useLocalEdits } from '../lib/useLocalEdits';
import { trpc, PILOT_WORKSPACE } from '../lib/trpc';

type TabId = 'overview' | 'artifacts' | 'interview' | 'evidence';

const STATUS_STYLE: Record<ArtifactStatus, { label: string; color: string; background: string }> = {
  ready:    { label: 'Ready',       color: 'var(--success)',       background: '#ECF7F1' },
  review:   { label: 'Needs review', color: '#8A5A00',             background: '#FFF6DD' },
  practice: { label: 'In practice', color: 'var(--color-steel)',   background: '#EEF4F7' },
  blocked:  { label: 'Blocked',     color: 'var(--danger)',        background: '#FCEEEE' },
};

const ARTIFACT_ICON: Record<string, typeof FileText> = {
  resume:               FileText,
  'cover-letter':       MessageSquareText,
  'application-answers': FileCheck2,
  networking:           Users,
  'behavioral-stories': Sparkles,
  'case-prep':          Target,
  'interviewer-questions': Lightbulb,
  'submission-checklist': ShieldCheck,
};

function StatusPill({ status }: { status: ArtifactStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="rounded-full px-2 py-1 text-[11px] font-semibold" style={{ color: s.color, backgroundColor: s.background }}>
      {s.label}
    </span>
  );
}

function SectionCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border bg-white p-5 ${className}`} style={{ borderColor: 'var(--color-border)' }}>
      <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>{title}</h2>
      {children}
    </section>
  );
}

/* ── Agent Insights Panel ─────────────────────────────────────────────── */

function AgentInsightsPanel({ artifact }: { artifact: ApplicationArtifact }) {
  const [open, setOpen] = useState(false);

  const relatedEvidence = useMemo(
    () => BCG_APPLICATION.evidence.filter((e) => artifact.evidenceIds?.includes(e.id as never)),
    [artifact.evidenceIds],
  );
  const needsReview = relatedEvidence.filter((e) => e.status === 'needs-review');
  const verified    = relatedEvidence.filter((e) => e.status === 'verified');

  const hasInsights = relatedEvidence.length > 0;

  return (
    <div className="border-b" style={{ borderColor: 'var(--color-border)' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-[var(--color-surface)]"
        style={{ color: 'var(--color-navy-mid)' }}
      >
        <Bot className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-steel)' }} />
        <span className="flex-1 text-xs font-semibold" style={{ color: 'var(--color-navy)' }}>
          Research foundation
        </span>
        {hasInsights && (
          <>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: 'var(--color-steel)', backgroundColor: '#EEF4F7' }}>
              {verified.length} verified
            </span>
            {needsReview.length > 0 && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: '#8A5A00', backgroundColor: '#FFF6DD' }}>
                {needsReview.length} need review
              </span>
            )}
          </>
        )}
        {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
      </button>

      {open && (
        <div className="border-t px-5 pb-5 pt-4 space-y-5" style={{ borderColor: 'var(--color-border)', backgroundColor: '#FAFAF7' }}>

          {/* Sources */}
          <div>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>
              Source documents
            </p>
            <div className="space-y-1.5">
              {BCG_APPLICATION.sources.map((source) => (
                <div key={source.label} className="flex items-start gap-2">
                  <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--color-steel)' }} />
                  <div>
                    <span className="text-xs font-medium" style={{ color: 'var(--color-navy)' }}>{source.label}</span>
                    <span className="ml-1.5 text-xs" style={{ color: 'var(--color-warm-gray)' }}>{source.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Evidence claims */}
          {relatedEvidence.length > 0 && (
            <div>
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>
                Evidence claims ({relatedEvidence.length})
              </p>
              <div className="space-y-2">
                {relatedEvidence.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border p-3"
                    style={{
                      borderColor: item.status === 'verified' ? 'var(--color-border)' : '#E7C978',
                      backgroundColor: item.status === 'verified' ? 'white' : '#FFFBEE',
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {item.status === 'verified'
                        ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--success)' }} />
                        : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: '#8A5A00' }} />}
                      <div className="min-w-0">
                        <p className="text-xs leading-5" style={{ color: 'var(--color-navy)' }}>{item.claim}</p>
                        <p className="mt-0.5 text-[10px]" style={{ color: 'var(--color-warm-gray)' }}>{item.source}</p>
                        {item.note && (
                          <p className="mt-1.5 text-[10px] leading-4" style={{ color: '#8A5A00' }}>⚠ {item.note}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <a
            href={BCG_APPLICATION.source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
            style={{ color: 'var(--color-steel)' }}
          >
            Open official BCG guidance <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}

/* ── Artifact Viewer ──────────────────────────────────────────────────── */

function ArtifactViewer({ artifact }: { artifact: ApplicationArtifact }) {
  const [copied, setCopied] = useState(false);
  const { fieldValue, setEdit, isEdited } = useLocalEdits(`jobpilot.artifact.${artifact.id}`);
  const Icon = ARTIFACT_ICON[artifact.id] ?? FileText;

  const copyArtifact = async () => {
    const text = artifact.sections
      .map((s, i) => [
        fieldValue(`s${i}.heading`, s.heading),
        fieldValue(`s${i}.body`, s.body),
        ...(s.bullets ?? []).map((b, j) => fieldValue(`s${i}.b${j}`, b)),
      ].join('\n'))
      .join('\n\n');
    await navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="min-w-0 rounded-xl border bg-white" style={{ borderColor: 'var(--color-border)' }}>
      {/* Header */}
      <div
        className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-start sm:justify-between"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-steel)' }}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>
                {artifact.title}
              </h2>
              <StatusPill status={artifact.status} />
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-warm-gray)' }}>{artifact.description}</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-warm-gray)' }}>
              {artifact.ownerAgent} Agent · {artifact.skill} Skill · {artifact.updated}
            </p>
          </div>
        </div>
        <button
          onClick={copyArtifact}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors hover:bg-[var(--color-surface)]"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy working draft'}
        </button>
      </div>

      {/* Agentic insights — collapsible */}
      <AgentInsightsPanel artifact={artifact} />

      {/* Sections — all fields double-click editable */}
      <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
        {artifact.sections.map((section, i) => (
          <div key={section.heading} className="p-5" style={{ borderColor: 'var(--color-border)' }}>
            <EditableField
              value={fieldValue(`s${i}.heading`, section.heading)}
              baseValue={section.heading}
              onSave={(v) => setEdit(`s${i}.heading`, v)}
              as="h3"
              className="mb-2 text-sm font-semibold"
              style={{ color: 'var(--color-navy)' }}
            />
            <EditableField
              value={fieldValue(`s${i}.body`, section.body)}
              baseValue={section.body}
              onSave={(v) => setEdit(`s${i}.body`, v)}
              multiline
              as="div"
              className="whitespace-pre-line text-sm leading-6"
              style={{ color: 'var(--color-navy-mid)' }}
            />
            {section.bullets && (
              <ul className="mt-3 space-y-2">
                {section.bullets.map((bullet, j) => (
                  <li key={j} className="flex gap-2 text-sm leading-6" style={{ color: 'var(--color-navy-mid)' }}>
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--color-steel)' }} />
                    <EditableField
                      value={fieldValue(`s${i}.b${j}`, bullet)}
                      baseValue={bullet}
                      onSave={(v) => setEdit(`s${i}.b${j}`, v)}
                      as="span"
                      className="flex-1 text-sm leading-6"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Culture Research (JP3B, TASK-011) ───────────────────────────────── */
/* TASK-011 remediation (2026-07-18 coordinator final review, issue 7): this
 * section is now LIVE — it queries the real `jobpilot.cultureResearch.*`
 * procedures and renders whatever the API actually returns. Before any
 * research has been proposed/approved, it shows an honest empty state and an
 * action to start research — never a placeholder claim. The source-rights
 * disclosure gates the grounded evidence exactly as before (JP3B exit: "the
 * user sees citations and a rights/access warning BEFORE using
 * recommendations"), but now over REAL persisted synthesis output, complete
 * with citations, content hashes, and an approval timestamp.
 *
 * Claim authoring here is intentionally minimal for this pass: once a source
 * is fetched, its ENTIRE real content is submitted as one grounded "fact"
 * claim (`deriveBoundedArtifactFactClaim`) — never fabricated text. A richer
 * human-excerpt-picker or LLM-assisted theme/opinion/contradiction extraction
 * is tracked as future work; the honest result today is a `facts` bucket
 * populated with real cited claims and other buckets empty (a true empty
 * result, not a fabricated one), matching how the server-side partition
 * already renders a `contradictions: []` result. */

type CultureSourceListItem = Awaited<ReturnType<typeof trpc.jobpilot.cultureResearch.sources.query>>[number];
type CultureFetchStatusResult = Awaited<ReturnType<typeof trpc.jobpilot.cultureResearch.status.query>>;
type CultureSynthesisResult = Awaited<ReturnType<typeof trpc.jobpilot.cultureResearch.synthesisResult.query>>;

const CULTURE_GROUP_META: { key: 'facts' | 'themes' | 'opinions' | 'contradictions' | 'inferences'; label: string; emptyNote: string }[] = [
  { key: 'facts', label: 'Facts', emptyNote: 'No documented facts identified yet.' },
  { key: 'themes', label: 'Repeated themes', emptyNote: 'No repeated theme identified yet.' },
  { key: 'opinions', label: 'Attributed opinions', emptyNote: 'No attributed opinions identified yet.' },
  { key: 'contradictions', label: 'Contradictions', emptyNote: 'No contradicting accounts found among the permitted sources used for this run — this is an honest empty result, not a fabricated one. Reddit and Glassdoor reviews (a likelier source of disputing accounts) are currently skipped; see the disclosure above.' },
  { key: 'inferences', label: 'Agent inference', emptyNote: 'No inference offered yet.' },
];

function CultureResearchSection() {
  const workspaceId = PILOT_WORKSPACE;
  const company = BCG_APPLICATION.company;

  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [sources, setSources] = useState<CultureSourceListItem[] | null>(null);
  const [pointer, setPointer] = useState<StoredCultureResearchState | null>(null);
  const [statuses, setStatuses] = useState<Record<string, CultureFetchStatusResult>>({});
  const [result, setResult] = useState<CultureSynthesisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // TASK-011 remediation (2026-07-19 coordinator distributed-defects
  // review, issue 13): discover the server-owned sources for this company,
  // AND the SERVER-AUTHORITATIVE pointer to any in-progress/completed run
  // via `latestRun` — never trust `localStorage` alone. `localStorage` is
  // read first ONLY to paint an instant, optimistic hint while the network
  // call is in flight; the `latestRun` result then OVERWRITES it
  // unconditionally (including with `null`, clearing a stale/foreign
  // pointer) once it resolves, so clearing storage or switching devices
  // still surfaces real pending/completed research.
  //
  // TASK-011 remediation (2026-07-19 coordinator distributed-defects
  // RE-review, issue 12) — factored into a reusable callback so the SAME
  // server-authoritative reconciliation also runs on window focus (a
  // SECOND device/tab approving a decision must become visible here
  // without a full page reload) and can be reused after a mutation.
  const reconcileFromServer = useCallback(() => {
    let cancelled = false;
    trpc.jobpilot.cultureResearch.latestRun
      .query({ workspaceId, company })
      .then((serverRun) => {
        if (cancelled) return;
        if (serverRun) {
          const authoritative: StoredCultureResearchState = {
            parentRunId: serverRun.parentRunId,
            pending: serverRun.pending,
            ...(serverRun.synthesisProposalId ? { synthesisProposalId: serverRun.synthesisProposalId } : {}),
          };
          setPointer(authoritative);
          if (typeof window !== 'undefined') saveStoredCultureResearchState(window.localStorage, workspaceId, company, authoritative);
        } else {
          // Server has no record for this company — any locally cached
          // pointer is stale/foreign; clear it rather than trusting it.
          setPointer(null);
          if (typeof window !== 'undefined') clearStoredCultureResearchState(window.localStorage, workspaceId, company);
        }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; };
    // Deliberately stable-identity: `workspaceId`/`company` are constant for
    // this component instance (PILOT_WORKSPACE and BCG_APPLICATION.company
    // never change), so omitting them from the deps array is safe.
  }, []);

  useEffect(() => {
    let cancelled = false;
    trpc.jobpilot.cultureResearch.sources
      .query({ workspaceId, company })
      .then((s) => { if (!cancelled) setSources(s); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    if (typeof window !== 'undefined') {
      setPointer(loadStoredCultureResearchState(window.localStorage, workspaceId, company));
    }
    const cancelReconcile = reconcileFromServer();
    return () => { cancelled = true; cancelReconcile(); };
    // Deliberately mount-only: `workspaceId`/`company` are constant for this
    // component instance (PILOT_WORKSPACE and BCG_APPLICATION.company never
    // change), so omitting them from the deps array is safe.
  }, []);

  // TASK-011 remediation (2026-07-19 coordinator distributed-defects
  // RE-review, issue 12) — re-reconcile against the server whenever this
  // tab/window regains focus, so a decision approved from a SECOND device
  // or tab becomes visible here without requiring a manual reload. Only
  // wired after the initial mount hydration has already completed, and
  // gated on `hydrated` so a focus event during the very first load doesn't
  // race the mount effect's own reconciliation.
  useEffect(() => {
    if (typeof window === 'undefined' || !hydrated) return;
    const onFocus = () => { reconcileFromServer(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [hydrated, reconcileFromServer]);

  // Re-fetch live state whenever the pointer changes (including on initial
  // hydration) — every claim/citation/hash/disclosure the user sees comes
  // from these calls, never from anything cached locally.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    async function refresh() {
      if (!pointer) { setResult(null); return; }
      if (pointer.synthesisProposalId) {
        try {
          const r = await trpc.jobpilot.cultureResearch.synthesisResult.query({ workspaceId, company, parentRunId: pointer.parentRunId, proposalId: pointer.synthesisProposalId });
          if (!cancelled) setResult(r);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
      }
      const nextStatuses: Record<string, CultureFetchStatusResult> = {};
      await Promise.all(
        pointer.pending.map(async (p) => {
          try {
            nextStatuses[p.proposalId] = await trpc.jobpilot.cultureResearch.status.query({ workspaceId, proposalId: p.proposalId, childRunId: p.childRunId });
          } catch {
            // Unknown/inaccessible — drop it from the live view rather than
            // showing a stale local guess.
          }
        }),
      );
      if (!cancelled) setStatuses(nextStatuses);
    }
    refresh();
    return () => { cancelled = true; };
  }, [pointer, hydrated]);

  function persistPointer(next: StoredCultureResearchState) {
    setPointer(next);
    if (typeof window !== 'undefined') saveStoredCultureResearchState(window.localStorage, workspaceId, company, next);
  }

  // TASK-011 remediation (2026-07-19 coordinator distributed-defects
  // review, issue 13): "if proposal already approved, do not call decide
  // again; reconcile/materialize based on durable status." `action.decide`
  // fails closed with a 409 CONFLICT (`AlreadyResolvedError`) on a proposal
  // that was already resolved — e.g. approved in an earlier session/device
  // and the local pointer was rediscovered via `latestRun` above. That is
  // NOT a real failure here: it means the approval already happened, so the
  // caller should proceed exactly as if `decide` had just succeeded, rather
  // than surfacing a scary error for an already-successful outcome.
  function isAlreadyResolvedConflict(e: unknown): boolean {
    return e instanceof TRPCClientError && e.data?.code === 'CONFLICT';
  }

  async function startResearch() {
    const permittedIds = (sources ?? []).filter((s) => s.eligibility === 'permitted').map((s) => s.id);
    if (permittedIds.length === 0) {
      setError('No permitted culture-research sources are configured for this company yet.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const proposed = await trpc.jobpilot.cultureResearch.propose.mutate({ workspaceId, company, sourceIds: permittedIds });
      persistPointer({ parentRunId: proposed.parentRunId, pending: proposed.pending });
      // TASK-011 remediation (2026-07-19 RE-review, issue 12) — refetch the
      // server-authoritative pointer after every mutation, not only the
      // client's own optimistic update from this call's response.
      reconcileFromServer();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function approveAndFetch(p: StoredCultureResearchState['pending'][number]) {
    setBusy(true);
    setError(null);
    try {
      try {
        await trpc.action.decide.mutate({ proposalId: p.proposalId, decision: 'approve' });
      } catch (e) {
        if (!isAlreadyResolvedConflict(e)) throw e;
        // Already approved (e.g. from another session) — reconcile via materialize below.
      }
      const record = await trpc.jobpilot.cultureResearch.materialize.mutate({ workspaceId, proposalId: p.proposalId, childRunId: p.childRunId });
      setStatuses((prev) => ({ ...prev, [p.proposalId]: record }));
      reconcileFromServer();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function synthesize() {
    if (!pointer) return;
    const fetchedEntries = pointer.pending
      .map((p) => ({ p, status: statuses[p.proposalId] }))
      .filter(
        (x): x is { p: (typeof pointer.pending)[number]; status: CultureFetchStatusResult & { status: 'fetched' } } =>
          x.status?.status === 'fetched' && isArtifactUsable(x.status.artifact),
      );
    if (fetchedEntries.length === 0) {
      const anyExpired = pointer.pending.some((p) => statuses[p.proposalId]?.status === 'fetched' && !isArtifactUsable(statuses[p.proposalId]!.artifact));
      setError(
        anyExpired
          ? 'Every previously fetched source has expired — start a new research run before synthesizing.'
          : 'At least one source must be approved and fetched before synthesis.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const claims = fetchedEntries.map(({ p, status }) => deriveBoundedArtifactFactClaim(`claim-${p.sourceId}`, p.sourceId, status.artifact!));
      const synth = await trpc.jobpilot.cultureResearch.synthesize.mutate({ workspaceId, company, parentRunId: pointer.parentRunId, claims });
      persistPointer({ ...pointer, synthesisProposalId: synth.proposalId });
      reconcileFromServer();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function approveSynthesis() {
    if (!pointer?.synthesisProposalId) return;
    setBusy(true);
    setError(null);
    try {
      try {
        await trpc.action.decide.mutate({ proposalId: pointer.synthesisProposalId, decision: 'approve' });
      } catch (e) {
        if (!isAlreadyResolvedConflict(e)) throw e;
        // Already approved — reconcile via synthesisResult below.
      }
      const r = await trpc.jobpilot.cultureResearch.synthesisResult.query({ workspaceId, company, parentRunId: pointer.parentRunId, proposalId: pointer.synthesisProposalId });
      setResult(r);
      reconcileFromServer();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const available = result?.status === 'available' ? result : null;

  return (
    <SectionCard title="Culture research">
      <p className="mb-4 text-xs" style={{ color: 'var(--color-warm-gray)' }}>
        Learning Agent · research company culture Skill → Internal Strategist Agent · synthesize culture evidence Skill
      </p>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--danger)', backgroundColor: '#FCEEEE', color: 'var(--danger)' }}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* TASK-011 remediation (2026-07-19 coordinator distributed-defects
          RE-review, issue 12) — a DISTINCT loading state while the mount
          effect is still reconciling against the server-authoritative
          `latestRun` query. Before this, the section rendered nothing at
          all during that window — indistinguishable from "no research has
          ever been run" (the empty state below), which could flash
          misleadingly before the real state resolves. */}
      {!hydrated && (
        <div className="rounded-lg border p-4 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>
          Loading culture research status…
        </div>
      )}

      {/* Honest empty state — no research proposed/persisted yet. */}
      {hydrated && !pointer && !available && (
        <div className="rounded-lg border p-4 text-center" style={{ borderColor: 'var(--color-border)', backgroundColor: '#FAFAF7' }}>
          <p className="mb-3 text-sm" style={{ color: 'var(--color-warm-gray)' }}>
            No culture research has been run for this application yet.
          </p>
          <button
            onClick={startResearch}
            disabled={busy || sources === null}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-steel)' }}
          >
            {busy ? 'Starting…' : 'Start culture research'}
          </button>
        </div>
      )}

      {/* Pending sources awaiting approval/fetch — real, per-source live status. */}
      {pointer && !available && (
        <div className="space-y-2">
          {pointer.pending.map((p) => {
            const status = statuses[p.proposalId];
            // TASK-011 remediation (2026-07-19 coordinator distributed-
            // defects RE-review round 2, issue 9) — a "fetched" status whose
            // artifact is no longer usable (expired/purged) must NEVER be
            // rendered as a plain fetched-success checkmark — that would be
            // showing fetched success for content that is, in truth, gone.
            const fetchedButExpired = status?.status === 'fetched' && !isArtifactUsable(status.artifact);
            return (
              <div key={p.proposalId} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                <div>
                  <span className="text-sm font-medium" style={{ color: 'var(--color-navy)' }}>{p.sourceLabel}</span>
                  <span className="ml-2 text-xs" style={{ color: 'var(--color-warm-gray)' }}>
                    {fetchedButExpired ? 'expired' : status?.status ?? 'pending'}
                  </span>
                </div>
                {(!status || status.status === 'pending') && (
                  <button onClick={() => approveAndFetch(p)} disabled={busy} className="rounded-md px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--success)' }}>
                    Approve &amp; fetch
                  </button>
                )}
                {status?.status === 'fetched' && !fetchedButExpired && <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--success)' }} />}
                {fetchedButExpired && <AlertTriangle className="h-4 w-4" style={{ color: '#8A5A00' }} />}
                {status?.status === 'failed' && <XCircle className="h-4 w-4" style={{ color: 'var(--danger)' }} />}
              </div>
            );
          })}
          {(() => {
            const anyUsable = pointer.pending.some((p) => statuses[p.proposalId]?.status === 'fetched' && isArtifactUsable(statuses[p.proposalId]!.artifact));
            const anyFetched = pointer.pending.some((p) => statuses[p.proposalId]?.status === 'fetched');
            const allFetchedExpired = anyFetched && !anyUsable;
            return (
              <>
                {allFetchedExpired && (
                  <p className="mt-2 text-xs" style={{ color: '#8A5A00' }}>
                    Every fetched source has expired — its raw content has been purged and can no longer ground a synthesis. Start a new research run to re-fetch permitted sources.
                  </p>
                )}
                {!pointer.synthesisProposalId && (
                  <button
                    onClick={synthesize}
                    disabled={busy || allFetchedExpired}
                    className="mt-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-steel)' }}
                  >
                    Synthesize evidence
                  </button>
                )}
                {allFetchedExpired && (
                  <button
                    onClick={startResearch}
                    disabled={busy}
                    className="mt-2 ml-2 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    style={{ borderColor: 'var(--color-steel)', color: 'var(--color-steel)' }}
                  >
                    {busy ? 'Starting…' : 'Start new research run'}
                  </button>
                )}
              </>
            );
          })()}
          {pointer.synthesisProposalId && (
            <button onClick={approveSynthesis} disabled={busy} className="mt-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-steel)' }}>
              Approve synthesis
            </button>
          )}
        </div>
      )}

      {/* Source-rights disclosure — clickable, gates the evidence below (JP3B exit:
          "the user sees citations and a rights/access warning BEFORE using recommendations"). */}
      {available && (
        <>
          <button
            onClick={() => setDisclosureOpen((o) => !o)}
            className="flex w-full items-center gap-2 rounded-lg border px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface)]"
            style={{ borderColor: '#E7C978', backgroundColor: '#FFFBEE' }}
          >
            <ShieldAlert className="h-4 w-4 shrink-0" style={{ color: '#8A5A00' }} />
            <span className="flex-1 text-sm font-semibold" style={{ color: '#8A5A00' }}>
              Source rights &amp; access — review before using these suggestions
            </span>
            {disclosureOpen ? <ChevronUp className="h-4 w-4 shrink-0" style={{ color: '#8A5A00' }} /> : <ChevronDown className="h-4 w-4 shrink-0" style={{ color: '#8A5A00' }} />}
          </button>

          {!disclosureOpen && (
            <p className="mt-3 text-xs italic" style={{ color: 'var(--color-warm-gray)' }}>
              Open the disclosure above to see exactly which sources were used and which were skipped (and why) before viewing culture-informed evidence. Approved {new Date(available.approvedAt).toLocaleString()}.
            </p>
          )}

          {disclosureOpen && (
            <div className="mt-3 space-y-4 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: '#FAFAF7' }}>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>
                  Sources used ({available.result.disclosure.used.length})
                </p>
                {available.result.disclosure.used.map((s) => (
                  <a
                    key={s.sourceUrl}
                    href={s.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-1 flex items-center gap-1.5 text-xs font-medium hover:underline"
                    style={{ color: 'var(--color-steel)' }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--success)' }} />
                    {s.sourceLabel} <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>
                  Sources skipped ({available.result.disclosure.skipped.length}) — no access, no fetch, no bypass
                </p>
                <div className="space-y-2">
                  {available.result.disclosure.skipped.map((s) => (
                    <div key={s.sourceLabel} className="flex items-start gap-2">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--danger)' }} />
                      <div>
                        <span className="text-xs font-semibold" style={{ color: 'var(--color-navy)' }}>{s.sourceLabel}</span>
                        <p className="text-xs leading-5" style={{ color: 'var(--color-warm-gray)' }}>{s.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {disclosureOpen && (
            <div className="mt-5 space-y-5">
              {CULTURE_GROUP_META.map((group) => {
                const items = available.result.partition[group.key];
                return (
                  <div key={group.key}>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-navy-mid)' }}>
                      {group.label} ({items.length})
                    </h3>
                    {items.length === 0 ? (
                      <p className="text-xs leading-5 italic" style={{ color: 'var(--color-warm-gray)' }}>{group.emptyNote}</p>
                    ) : (
                      <div className="space-y-2">
                        {items.map((item) => (
                          <div key={item.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white' }}>
                            {item.agentInference && (
                              <span className="mb-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: 'var(--color-steel)', backgroundColor: '#EEF4F7' }}>
                                <Bot className="h-3 w-3" /> Agent inference — not a verified fact
                              </span>
                            )}
                            <p className="flex items-start gap-1.5 text-sm leading-6" style={{ color: 'var(--color-navy)' }}>
                              {item.claimType === 'opinion' && <Quote className="mt-1 h-3 w-3 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />}
                              {item.claimText}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>
                              <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline" style={{ color: 'var(--color-steel)' }}>
                                {item.sourceLabel} <ExternalLink className="h-3 w-3" />
                              </a>
                              <span>Retrieved {item.retrievedAt}</span>
                              {item.authorContext && <span>{item.authorContext}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export function JobPilotApplicationDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState<TabId>('overview');
  const [selectedArtifact, setSelectedArtifact] = useState('resume');
  const application = id === BCG_APPLICATION.id ? BCG_APPLICATION : null;
  const selected = artifactById(selectedArtifact) ?? BCG_APPLICATION.artifacts[0];

  /* Overview fields — inline editable */
  const overviewEdits = useLocalEdits('jobpilot.overview.bcg');

  const agents = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const artifact of BCG_APPLICATION.artifacts) {
      const skills = grouped.get(artifact.ownerAgent) ?? [];
      if (!skills.includes(artifact.skill)) skills.push(artifact.skill);
      grouped.set(artifact.ownerAgent, skills);
    }
    return Array.from(grouped.entries());
  }, []);

  if (!application) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-navy)' }}>Application not found</h1>
          <Link className="mt-3 inline-block text-sm font-semibold" style={{ color: 'var(--color-steel)' }} to="/jobpilot">Back to JobPilot</Link>
        </div>
      </div>
    );
  }

  const openArtifact = (artifact: ApplicationArtifact) => { setSelectedArtifact(artifact.id); setTab('artifacts'); };
  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview',  label: 'Overview' },
    { id: 'artifacts', label: `Artifacts ${application.artifacts.length}` },
    { id: 'interview', label: 'Interview prep' },
    { id: 'evidence',  label: `Evidence ${application.evidence.length}` },
  ];

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden" style={{ backgroundColor: '#FAF9F5' }}>
      <header className="shrink-0 border-b bg-white px-4 pt-4 sm:px-6" style={{ borderColor: 'var(--color-border)' }}>
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 flex items-start gap-3">
            <Link to="/jobpilot" title="Back to JobPilot" className="mt-0.5 rounded-lg p-2 transition-colors hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-navy-mid)' }}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: '#1A4731' }}>
              <BriefcaseBusiness className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full px-2 py-1 text-[11px] font-semibold" style={{ color: '#8A5A00', backgroundColor: '#FFF6DD' }}>{application.stage}</span>
                <span className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{application.lastUpdated}</span>
              </div>
              <h1 className="mt-1 text-2xl font-semibold sm:text-3xl" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>{application.role}</h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--color-navy-mid)' }}>{application.company} · {application.location}</p>
            </div>
            <div className="hidden rounded-lg border px-3 py-2 text-right sm:block" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warm-gray)' }}>Decision</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--success)' }}>
                <Flag className="h-3.5 w-3.5 fill-current" />{application.fit.recommendation}
              </div>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto" aria-label="Application sections">
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className="relative shrink-0 px-3 pb-3 pt-1 text-sm font-medium"
                style={{ color: tab === item.id ? 'var(--color-steel)' : 'var(--color-warm-gray)' }}
              >
                {item.label}
                {tab === item.id && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full" style={{ backgroundColor: 'var(--color-steel)' }} />}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-6xl">

          {/* ── OVERVIEW ── */}
          {tab === 'overview' && (
            <div className="space-y-5">
              <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
                <SectionCard title="Fit decision">
                  <EditableField
                    value={overviewEdits.fieldValue('fit.summary', application.fit.summary)}
                    baseValue={application.fit.summary}
                    onSave={(v) => overviewEdits.setEdit('fit.summary', v)}
                    multiline
                    as="p"
                    className="text-sm leading-6"
                    style={{ color: 'var(--color-navy-mid)' }}
                  />
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div>
                      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--success)' }}>
                        <CheckCircle2 className="h-4 w-4" />Why pursue
                      </h3>
                      <ul className="space-y-2">
                        {application.fit.strengths.map((item, i) => (
                          <li key={i}>
                            <EditableField
                              value={overviewEdits.fieldValue(`fit.strength.${i}`, item)}
                              baseValue={item}
                              onSave={(v) => overviewEdits.setEdit(`fit.strength.${i}`, v)}
                              as="span"
                              className="text-sm leading-5"
                              style={{ color: 'var(--color-navy-mid)' }}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: '#8A5A00' }}>
                        <AlertTriangle className="h-4 w-4" />Resolve first
                      </h3>
                      <ul className="space-y-2">
                        {application.fit.concerns.map((item, i) => (
                          <li key={i}>
                            <EditableField
                              value={overviewEdits.fieldValue(`fit.concern.${i}`, item)}
                              baseValue={item}
                              onSave={(v) => overviewEdits.setEdit(`fit.concern.${i}`, v)}
                              as="span"
                              className="text-sm leading-5"
                              style={{ color: 'var(--color-navy-mid)' }}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </SectionCard>
                <SectionCard title="Submission gate">
                  <div className="mb-4 flex items-start gap-3 rounded-lg p-3" style={{ backgroundColor: '#FCEEEE' }}>
                    <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--danger)' }} />
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>External submission blocked</div>
                      <p className="mt-1 text-xs leading-5" style={{ color: 'var(--color-navy-mid)' }}>JobPilot can prepare the packet, but only you can approve what leaves Bridge.</p>
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {application.submission.blockers.map((blocker) => (
                      <li key={blocker} className="flex gap-2 text-sm" style={{ color: 'var(--color-navy-mid)' }}>
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--danger)' }} />{blocker}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => openArtifact(artifactById('submission-checklist')!)}
                    className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-[var(--color-surface)]"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-steel)' }}
                  >
                    Open review packet <ChevronRight className="h-4 w-4" />
                  </button>
                </SectionCard>
              </div>

              <SectionCard title="Application artifacts">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {application.artifacts.map((artifact) => {
                    const Icon = ARTIFACT_ICON[artifact.id] ?? FileText;
                    return (
                      <button
                        key={artifact.id}
                        onClick={() => openArtifact(artifact)}
                        className="rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: '#FFFEFC' }}
                      >
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-steel)' }}>
                            <Icon className="h-4.5 w-4.5" />
                          </div>
                          <StatusPill status={artifact.status} />
                        </div>
                        <div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{artifact.title}</div>
                        <div className="mt-1 line-clamp-2 text-xs leading-5" style={{ color: 'var(--color-warm-gray)' }}>{artifact.description}</div>
                        {artifact.evidenceIds && artifact.evidenceIds.length > 0 && (
                          <div className="mt-2 text-[10px]" style={{ color: 'var(--color-steel)' }}>
                            {artifact.evidenceIds.length} evidence items
                          </div>
                        )}
                        <div className="mt-3 flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--color-steel)' }}>
                          Open artifact <ChevronRight className="h-3 w-3" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </SectionCard>

              <div className="grid gap-5 lg:grid-cols-2">
                <SectionCard title="BCG evaluation map">
                  <div className="space-y-3">
                    {application.fit.dimensions.map((dimension) => (
                      <div key={dimension.label} className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
                        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>
                          <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--success)' }} />{dimension.label}
                        </div>
                        <p className="mt-1 pl-6 text-xs leading-5" style={{ color: 'var(--color-navy-mid)' }}>{dimension.evidence}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>
                <SectionCard title="Agents and their Skills">
                  <p className="mb-3 text-xs leading-5" style={{ color: 'var(--color-warm-gray)' }}>
                    Skills are available only through their allowed Agent. Every artifact shows who created or maintains it.
                  </p>
                  <div className="space-y-2">
                    {agents.map(([agent, skills]) => (
                      <div key={agent} className="flex items-center gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
                        <Bot className="h-4 w-4" style={{ color: 'var(--color-steel)' }} />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{agent} Agent</div>
                          <div className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>{skills.join(' · ')} Skills</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>
            </div>
          )}

          {/* ── ARTIFACTS ── */}
          {tab === 'artifacts' && (
            <div className="grid gap-4 lg:grid-cols-[270px_minmax(0,1fr)]">
              <aside className="h-fit rounded-xl border bg-white p-2" style={{ borderColor: 'var(--color-border)' }}>
                {application.artifacts.map((artifact) => {
                  const Icon = ARTIFACT_ICON[artifact.id] ?? FileText;
                  return (
                    <button
                      key={artifact.id}
                      onClick={() => setSelectedArtifact(artifact.id)}
                      className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors"
                      style={{ backgroundColor: selectedArtifact === artifact.id ? 'var(--color-surface)' : 'transparent' }}
                    >
                      <Icon className="h-4 w-4 shrink-0" style={{ color: selectedArtifact === artifact.id ? 'var(--color-steel)' : 'var(--color-warm-gray)' }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" style={{ color: 'var(--color-navy)' }}>{artifact.title}</div>
                        <div className="mt-0.5 text-[11px]" style={{ color: STATUS_STYLE[artifact.status].color }}>{STATUS_STYLE[artifact.status].label}</div>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5" style={{ color: 'var(--color-warm-gray)' }} />
                    </button>
                  );
                })}
              </aside>
              <ArtifactViewer artifact={selected as ApplicationArtifact} />
            </div>
          )}

          {/* ── INTERVIEW ── */}
          {tab === 'interview' && (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                {['behavioral-stories', 'case-prep', 'interviewer-questions'].map((artifactId) => {
                  const artifact = artifactById(artifactId)!;
                  const Icon = ARTIFACT_ICON[artifact.id];
                  return (
                    <button key={artifact.id} onClick={() => openArtifact(artifact)} className="rounded-xl border bg-white p-5 text-left hover:shadow-sm" style={{ borderColor: 'var(--color-border)' }}>
                      <Icon className="h-5 w-5" style={{ color: 'var(--color-steel)' }} />
                      <h2 className="mt-3 text-base font-semibold" style={{ color: 'var(--color-navy)' }}>{artifact.title}</h2>
                      <p className="mt-1 text-sm leading-5" style={{ color: 'var(--color-warm-gray)' }}>{artifact.description}</p>
                      <div className="mt-4"><StatusPill status={artifact.status} /></div>
                    </button>
                  );
                })}
              </div>
              <ArtifactViewer artifact={artifactById('case-prep') as ApplicationArtifact} />
              <CultureResearchSection />
            </div>
          )}

          {/* ── EVIDENCE ── */}
          {tab === 'evidence' && (
            <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
              <SectionCard title="Claim ledger">
                <div className="space-y-3">
                  {application.evidence.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border p-4"
                      style={{ borderColor: item.status === 'verified' ? 'var(--color-border)' : '#E7C978', backgroundColor: item.status === 'verified' ? 'white' : '#FFFBEE' }}
                    >
                      <div className="flex items-start gap-3">
                        {item.status === 'verified'
                          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--success)' }} />
                          : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#8A5A00' }} />}
                        <div>
                          <p className="text-sm leading-5" style={{ color: 'var(--color-navy)' }}>{item.claim}</p>
                          <p className="mt-1 text-xs" style={{ color: 'var(--color-warm-gray)' }}>{item.source}</p>
                          {item.note && <p className="mt-2 text-xs leading-5" style={{ color: '#8A5A00' }}>{item.note}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
              <SectionCard title="Sources used">
                <div className="space-y-3">
                  {application.sources.map((source) => (
                    <div key={source.label} className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{source.label}</div>
                      <p className="mt-1 text-xs leading-5" style={{ color: 'var(--color-warm-gray)' }}>{source.detail}</p>
                    </div>
                  ))}
                  <a
                    href={application.source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-lg border p-3 text-sm font-semibold hover:bg-[var(--color-surface)]"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-steel)' }}
                  >
                    Open official BCG guidance <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </SectionCard>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

export default JobPilotApplicationDetail;
