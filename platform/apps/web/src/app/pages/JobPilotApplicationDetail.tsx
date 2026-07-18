import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  AlertTriangle, ArrowLeft, Bot, BriefcaseBusiness, Check, CheckCircle2, ChevronDown,
  ChevronRight, ChevronUp, Clipboard, ExternalLink, FileCheck2, FileText, Flag, Lightbulb,
  LockKeyhole, MessageSquareText, ShieldCheck, Sparkles, Target, Users, XCircle,
} from 'lucide-react';
import { BCG_APPLICATION, artifactById, type ApplicationArtifact, type ArtifactStatus } from '../data/bcg-application';
import { EditableField } from '../components/shared/EditableField';
import { useLocalEdits } from '../lib/useLocalEdits';

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
                {section.bullets.map((bullet, j) => {
                  const bulletValue = fieldValue(`s${i}.b${j}`, bullet);
                  return (
                    <li key={j} className="flex gap-2 text-sm leading-6" style={{ color: 'var(--color-navy-mid)' }}>
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--color-steel)' }} />
                      <EditableField
                        value={bulletValue}
                        baseValue={bullet}
                        onSave={(v) => setEdit(`s${i}.b${j}`, v)}
                        as="span"
                        className="flex-1 text-sm leading-6"
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
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
                        {application.fit.strengths.map((item, i) => {
                          const strengthValue = overviewEdits.fieldValue(`fit.strength.${i}`, item);
                          return (
                            <li key={i}>
                              <EditableField
                                value={strengthValue}
                                baseValue={item}
                                onSave={(v) => overviewEdits.setEdit(`fit.strength.${i}`, v)}
                                as="span"
                                className="text-sm leading-5"
                                style={{ color: 'var(--color-navy-mid)' }}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div>
                      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: '#8A5A00' }}>
                        <AlertTriangle className="h-4 w-4" />Resolve first
                      </h3>
                      <ul className="space-y-2">
                        {application.fit.concerns.map((item, i) => {
                          const concernValue = overviewEdits.fieldValue(`fit.concern.${i}`, item);
                          return (
                            <li key={i}>
                              <EditableField
                                value={concernValue}
                                baseValue={item}
                                onSave={(v) => overviewEdits.setEdit(`fit.concern.${i}`, v)}
                                as="span"
                                className="text-sm leading-5"
                                style={{ color: 'var(--color-navy-mid)' }}
                              />
                            </li>
                          );
                        })}
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
