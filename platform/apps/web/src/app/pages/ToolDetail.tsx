import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Pin, PinOff, Check, Eye, Radio, Inbox, Plus, X, ShieldCheck, RotateCw, ExternalLink } from 'lucide-react';
import { toolById, type Tool } from '../data/tools';
import { usePinnedTools } from '../lib/usePinnedTools';
import CardScanner from '../components/tools/cardscanner/CardScanner';
import Camera from '../components/tools/camera/Camera';
import { loadPendingCaptures, adoptCapture, dismissCapture, type ToolCapture, type CaptureSource } from '../data/toolCaptures';

// ── Pending captures panel (internalized capture-tools) ────────────────────────
// Quarantined captures from the standalone/shared-link tool. Each "Add" routes the
// capture through the governed pipeline (a Person + Touchpoint proposal → Approvals)
// and freezes the capture. Capture ≠ commit.
function ToolCapturesPanel({ color, toolId }: { color: string; toolId: string }) {
  const [captures, setCaptures] = useState<ToolCapture[]>([]);
  const [source, setSource] = useState<CaptureSource>('supabase');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'added' | 'dismissed'>>({});
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  async function refresh() {
    setLoading(true);
    const { captures, source } = await loadPendingCaptures(toolId);
    setCaptures(captures); setSource(source); setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function onAdd(c: ToolCapture) {
    setBusy(c.id);
    const outcome = await adoptCapture(c);
    setBusy(null);
    if (outcome) {
      setDone(d => ({ ...d, [c.id]: outcome === 'vetoed' ? 'dismissed' : 'added' }));
      setNote({
        text:
          outcome === 'pending'
            ? `Added ${c.person.name || 'capture'} — sent to Approvals for review`
            : outcome === 'approved'
              ? `${c.person.name || 'Capture'} was already approved and has been reconciled`
              : `${c.person.name || 'Capture'} was already vetoed and has been removed`,
        error: false,
      });
    } else {
      setNote({ text: `${c.person.name || 'Capture'} could not be reconciled with Approvals. It remains pending; retry when the API and storage are available.`, error: true });
    }
    setTimeout(() => setNote(null), 3600);
  }
  async function onDismiss(c: ToolCapture) {
    setBusy(c.id);
    const ok = await dismissCapture(c);
    setBusy(null);
    if (ok) {
      setDone(d => ({ ...d, [c.id]: 'dismissed' }));
    } else {
      setNote({ text: `${c.person.name || 'Capture'} could not be dismissed. It remains pending; retry when storage is available.`, error: true });
    }
  }

  const visible = captures.filter(c => !done[c.id]);

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ color: 'var(--color-warm-gray)' }}>
        <Inbox className="w-3.5 h-3.5" /> Pending captures
        <span className="ml-1 px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          {visible.length}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>
          {source === 'supabase' ? 'tool_captures · live' : 'offline · local'}
        </span>
      </h2>

      <div className="flex items-start gap-3 px-4 py-3 mb-4 rounded-xl border" style={{ borderColor: 'color-mix(in srgb, var(--color-steel) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-steel) 5%, transparent)' }}>
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--color-steel)' }} />
        <div className="text-xs" style={{ color: 'var(--color-navy-mid)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>Quarantined.</span> These were captured by the tool (standalone or a shared link) and have not entered your graph. <span className="font-semibold">Add</span> routes a capture through the governed pipeline — it becomes a Person + a “Met” Touchpoint proposal in Approvals, never a silent write.
        </div>
      </div>

      {note && (
        <div
          role={note.error ? 'alert' : 'status'}
          className="mb-3 px-3 py-2 rounded-lg text-xs font-medium"
          style={{
            backgroundColor: `color-mix(in srgb, var(--${note.error ? 'danger' : 'success'}) 12%, transparent)`,
            color: `var(--${note.error ? 'danger' : 'success'})`,
          }}
        >
          {note.text}
        </div>
      )}

      {loading ? (
        <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-warm-gray)' }}>Loading captures…</div>
      ) : visible.length === 0 ? (
        <div className="px-4 py-10 text-center rounded-xl border border-dashed" style={{ borderColor: 'var(--color-border)' }}>
          <Inbox className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--color-warm-gray)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--color-navy)' }}>No pending captures</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-warm-gray)' }}>Scan a card in the tool and tap “Add to Bridge” — it shows up here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map(c => (
            <div key={c.id} className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-start gap-3 p-4">
                {c.contract === 'conversation.v1' && c.conversation ? (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{c.conversation.title || c.conversation.initiative.name || 'Conversation'}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{c.dataScope} · Memory + {c.conversation.nextSteps.length} Touchpoints</span>
                    </div>
                    {c.conversation.summary && <p className="mt-1 text-xs line-clamp-2" style={{ color: 'var(--color-navy-mid)' }}>{c.conversation.summary}</p>}
                    {c.conversation.nextSteps.length > 0 && (
                      <ul className="mt-1.5 text-[11px] space-y-0.5" style={{ color: 'var(--color-warm-gray)' }}>
                        {c.conversation.nextSteps.slice(0, 3).map((s, i) => (
                          <li key={i}>→ {s.text}{s.owner ? ` (@${s.owner})` : ''}{s.due ? ` · due ${s.due}` : ''}</li>
                        ))}
                        {c.conversation.nextSteps.length > 3 && <li className="opacity-70">+{c.conversation.nextSteps.length - 3} more</li>}
                      </ul>
                    )}
                    <div className="mt-1.5 text-[11px] opacity-80" style={{ color: 'var(--color-warm-gray)' }}>{c.provenance.source ?? 'tool'}/{c.provenance.model ?? '—'} · → Initiative “{c.conversation.initiative.name}”</div>
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{c.person.name || 'Unnamed card'}</span>
                      {c.person.title && <span className="text-xs" style={{ color: 'var(--color-navy-mid)' }}>{c.person.title}</span>}
                      {c.person.company && <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{c.person.company}</span>}
                    </div>
                    <div className="mt-1 text-xs flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: 'var(--color-warm-gray)' }}>
                      {c.person.emails[0] && <span>{c.person.emails[0]}</span>}
                      {c.person.phones[0] && <span>{c.person.phones[0]}</span>}
                      {c.person.website && <span>{c.person.website}</span>}
                    </div>
                    <div className="mt-1.5 text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>
                      → {c.touchpoint.text} · <span className="opacity-80">{c.provenance.source ?? 'tool'}/{c.provenance.model ?? '—'} · {c.dataScope} scope</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => onAdd(c)} disabled={busy === c.id}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-colors active:scale-95 disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-steel)' }}>
                    <Plus className="w-3.5 h-3.5" /> {busy === c.id ? 'Adding…' : 'Add'}
                  </button>
                  <button onClick={() => onDismiss(c)} disabled={busy === c.id}
                    className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }} title="Dismiss">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Embedded tool surface — the tool's own app, faithful to its original UI ──────
// Runnable internalized tools (card-scanner, recorder) render their real app in an
// iframe right below the tool-path header. Captures still flow back through the
// governed Pending-captures panel below — embedding the UI ≠ bypassing governance.
function EmbeddedTool({ tool }: { tool: Tool }) {
  const [reloadKey, setReloadKey] = useState(0);
  const url = tool.appUrl!;
  let host = url; try { host = new URL(url).host; } catch { /* noop */ }
  return (
    <div className="flex flex-col shrink-0 border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      {/* slim run bar — Bridge chrome stays minimal so the tool's own UI is faithful */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0 bg-white" style={{ borderColor: 'var(--color-border)' }}>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--color-navy-mid)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--success)' }} /> Live tool · {host}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setReloadKey(k => k + 1)} title="Reload tool" className="p-1.5 rounded-md hover:bg-[var(--color-surface)] transition-colors" style={{ color: 'var(--color-warm-gray)' }}><RotateCw className="w-3.5 h-3.5" /></button>
          <a href={url} target="_blank" rel="noreferrer" title="Open in a new tab" className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md border transition-colors" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}><ExternalLink className="w-3.5 h-3.5" /> New tab</a>
        </div>
      </div>
      <iframe
        key={reloadKey}
        src={url}
        title={tool.name}
        className="w-full bg-white"
        style={{ border: 0, height: '78vh' }}
        allow="camera; microphone; clipboard-read; clipboard-write"
      />
      <div className="px-4 py-1.5 border-t text-[11px] shrink-0 bg-white" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>
        Loads from <span className="font-mono">{url}</span>. Blank? Start it — <span className="font-mono">cd {tool.source_repo?.split(' ')[0] || 'Tools'} && npm run dev</span>. Captures you Add to Bridge appear under <span className="font-semibold">Pending captures</span> below for review.
      </div>
    </div>
  );
}

export function ToolDetail() {
  const { id } = useParams();
  const { isPinned, togglePin } = usePinnedTools();
  const tool = id ? toolById(id) : undefined;

  if (!tool) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white gap-3 text-center px-6">
        <div className="text-lg font-semibold" style={{ color: 'var(--color-navy)' }}>Tool not found</div>
        <p className="text-sm" style={{ color: 'var(--color-warm-gray)' }}>This tool isn’t in your library.</p>
        <Link to="/tools" className="text-sm font-semibold" style={{ color: 'var(--color-steel)' }}>← Back to Tools</Link>
      </div>
    );
  }

  const Icon = tool.icon;
  const pinned = isPinned(tool.id);

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden relative">
      {/* Header — the tool path; Pin to sidebar sits on the same row, hard right (all tools) */}
      <div className="h-11 flex items-center justify-between px-6 border-b border-[var(--color-border)] shrink-0 bg-white z-20 gap-2">
        <div className="flex items-center gap-2 text-sm min-w-0">
          <Link to="/tools" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors shrink-0">Tools</Link>
          <ChevronRight className="w-3 h-3 shrink-0 text-[var(--color-warm-gray)]" />
          <span className="bg-[var(--color-surface)] text-[var(--color-navy)] px-2.5 py-0.5 rounded text-xs font-semibold truncate">{tool.name}</span>
        </div>
        <button
          onClick={() => togglePin(tool.id)}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all active:scale-95 shrink-0"
          style={pinned
            ? { backgroundColor: 'color-mix(in srgb, var(--color-steel) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--color-steel) 25%, transparent)', color: 'var(--color-steel)' }
            : { backgroundColor: 'white', borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}
          title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
        >
          {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          {pinned ? 'Pinned' : 'Pin to sidebar'}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-white flex flex-col">
        {/* Native tool — the real card-scanner UI, ported in-app (no separate server) */}
        {tool.id === 'card-scanner' && (
          <div className="border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <CardScanner />
          </div>
        )}
        {/* Native Camera — capture + the local governed captures panel render together */}
        {tool.id === 'camera' && (
          <div className="border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <Camera />
          </div>
        )}
        {/* Embedded tool (iframe) — for other runnable apps that still run standalone */}
        {tool.id !== 'card-scanner' && tool.appUrl && <EmbeddedTool tool={tool} />}

        <div className="max-w-3xl mx-auto w-full px-8 py-10 flex flex-col gap-10 pb-32">
          {/* Hero */}
          <div className="flex items-start gap-5">
            <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 border" style={{ backgroundColor: `color-mix(in srgb, ${tool.color} 12%, transparent)`, borderColor: `color-mix(in srgb, ${tool.color} 25%, transparent)` }}>
              <Icon className="w-7 h-7" style={{ color: tool.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="text-2xl font-bold text-[var(--color-navy)]">{tool.name}</h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 10%, transparent)', color: 'var(--success)', borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)' }}>
                  <Check className="w-3 h-3" /> {tool.status}
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{tool.category}</span>
              </div>
              <p className="text-[var(--color-navy-mid)] leading-relaxed">{tool.overview}</p>
              <div className="mt-2 text-xs" style={{ color: 'var(--color-warm-gray)' }}>Last used {tool.lastUsed}</div>
            </div>
          </div>

          {/* Pending captures — Supabase intake panel for card-scanner/recorder; camera uses its own LOCAL panel (inside <Camera/>) */}
          {tool.intake && tool.id !== 'camera' && <ToolCapturesPanel color={tool.color} toolId={tool.id} />}

          {/* Capabilities */}
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-warm-gray)' }}>What it does</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {tool.capabilities.map(c => (
                <div key={c} className="flex items-start gap-2.5 px-4 py-3 rounded-xl border bg-white" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: `color-mix(in srgb, ${tool.color} 14%, transparent)` }}>
                    <Check className="w-3 h-3" style={{ color: tool.color }} />
                  </div>
                  <span className="text-sm" style={{ color: 'var(--color-navy)' }}>{c}</span>
                </div>
              ))}
            </div>
          </div>

          {/* What it watches */}
          {tool.watches && tool.watches.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ color: 'var(--color-warm-gray)' }}>
                <Radio className="w-3.5 h-3.5" /> What it watches
              </h2>
              <div className="flex flex-wrap gap-2">
                {tool.watches.map(w => (
                  <span key={w} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)', backgroundColor: 'var(--color-surface)' }}>{w}</span>
                ))}
              </div>
            </div>
          )}

          {/* Governance note — every tool action is a draft, never a send */}
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border" style={{ borderColor: 'color-mix(in srgb, var(--color-steel) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-steel) 5%, transparent)' }}>
            <Eye className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--color-steel)' }} />
            <div className="text-xs" style={{ color: 'var(--color-navy-mid)' }}>
              <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>Draft-then-approve.</span> Running this tool drafts proposed actions into Approvals — nothing is sent or changed until you review it. Every decision is recorded to the governance ledger.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
