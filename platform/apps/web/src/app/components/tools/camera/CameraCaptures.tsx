import { useEffect, useState } from 'react';
import { Inbox, Plus, X, ShieldCheck, Check, Ban } from 'lucide-react';
import {
  listCaptures, listProposals, mirrorCaptureProposal, mirrorCaptureDecision, archiveCapture,
  getBlobUrl, type MediaCaptureRecord, type ProposalView,
} from '../../../data/localMedia';
import { PILOT_WORKSPACE, trpc } from '../../../lib/trpc';

export default function CameraCaptures() {
  const [pending, setPending] = useState<MediaCaptureRecord[]>([]);
  const [committed, setCommitted] = useState<MediaCaptureRecord[]>([]);
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    let [p, c, props] = await Promise.all([
      listCaptures({ status: 'pending' }), listCaptures({ status: 'committed' }), listProposals(),
    ]);
    const pendingProps = props.filter((proposal) => proposal.status === 'pending_review');
    if (pendingProps.length > 0) {
      const server = await trpc.capture.status.query({
        workspaceId: PILOT_WORKSPACE,
        localMediaIds: pendingProps.map((proposal) => proposal.mediaId),
      });
      let reconciled = false;
      for (const item of server.items) {
        if (
          (item.status === 'applied' || item.status === 'rejected') &&
          item.proposalId &&
          item.decisionLedgerId
        ) {
          await mirrorCaptureDecision(
            item.proposalId,
            item.status === 'applied' ? 'approve' : 'veto',
            item.decisionLedgerId,
            `capture:${PILOT_WORKSPACE}:${item.localMediaId}`,
          );
          reconciled = true;
        }
      }
      if (reconciled) {
        [p, c, props] = await Promise.all([
          listCaptures({ status: 'pending' }),
          listCaptures({ status: 'committed' }),
          listProposals(),
        ]);
      }
    }
    setPending(p); setCommitted(c); setProposals(props.filter((x) => x.status === 'pending_review'));
    const next: Record<string, string> = {};
    for (const r of [...p, ...c]) {
      next[r.id] = r.thumbnailDataUrl || (await getBlobUrl(r.id)) || '';
    }
    setUrls(next);
  }
  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }, []);

  function flash(msg: string) { setNote(msg); setTimeout(() => setNote(null), 3600); }

  async function onAdd(r: MediaCaptureRecord) {
    setBusy(r.id);
    setError(null);
    try {
      const proposal = await trpc.capture.stage.mutate({
        workspaceId: PILOT_WORKSPACE,
        localMediaId: r.id,
        kind: r.kind,
        ...(r.caption ? { caption: r.caption } : {}),
        ...(r.ocrText ? { ocrText: r.ocrText } : {}),
        capturedAt: r.capturedAt,
      });
      if (proposal.status !== 'pending_review') {
        throw new Error(
          proposal.status === 'rejected'
            ? proposal.rejectionReason || 'The capture proposal was rejected.'
            : 'Capture staging did not produce the required review gate.',
        );
      }
      const noun = r.kind === 'video' ? 'video' : 'photo';
      await mirrorCaptureProposal(
        proposal.id,
        r.id,
        {
          type: 'event',
          text: `Captured a ${noun}${r.caption ? ` — ${r.caption}` : ''}`,
          local_media_id: r.id,
          ...(r.ocrText ? { notes: r.ocrText } : {}),
        },
      );
      flash('Event proposal staged in the governed review queue.');
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }
  async function onDismiss(r: MediaCaptureRecord) {
    if (proposals.some((proposal) => proposal.mediaId === r.id)) {
      setError('Resolve the governed review before archiving this capture.');
      return;
    }
    setBusy(r.id);
    setError(null);
    try {
      await archiveCapture(r.id);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }
  async function onDecide(p: ProposalView, decision: 'approve' | 'veto') {
    setBusy(p.id);
    setError(null);
    try {
      const result = await trpc.action.decide.mutate({
        proposalId: p.id,
        decision,
      });
      if (result.effectsStatus !== 'confirmed') {
        throw new Error(result.effectsError || 'The governed capture effect did not complete.');
      }
      await mirrorCaptureDecision(
        p.id,
        decision,
        result.id,
        `capture:${PILOT_WORKSPACE}:${p.mediaId}`,
      );
      flash(
        decision === 'approve'
          ? 'Approved — materialized one private Event with an inspectable decision receipt.'
          : 'Vetoed — no Event was materialized.',
      );
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 mt-2">
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border" style={{ borderColor: 'color-mix(in srgb, var(--color-steel) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--color-steel) 5%, transparent)' }}>
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--color-steel)' }} />
        <div className="text-xs" style={{ color: 'var(--color-navy-mid)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-navy)' }}>Quarantined &amp; private.</span> Photos/videos live only on this device. <span className="font-semibold">Add to Bridge</span> raises a governed Event proposal — the blob never leaves; only an approved decision materializes an Event.
        </div>
      </div>
      {note && <div className="px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)' }}>{note}</div>}
      {error && <div role="alert" className="px-3 py-2 rounded-lg text-xs font-medium text-red-700 bg-red-50">{error}</div>}

      {/* Pending captures */}
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--color-warm-gray)' }}>
          <Inbox className="w-3.5 h-3.5" /> Pending captures <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 14%, transparent)', color: 'var(--color-steel)' }}>{pending.length}</span>
        </h3>
        {pending.length === 0 ? (
          <p className="text-xs px-4 py-6 text-center rounded-xl border border-dashed" style={{ borderColor: 'var(--color-border)', color: 'var(--color-warm-gray)' }}>No pending captures. Capture a photo or video above.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {pending.map((r) => (
              <div key={r.id} className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                {r.kind === 'photo' && urls[r.id]
                  ? <img src={urls[r.id]} alt="capture" className="w-full h-36 object-cover" />
                  : r.kind === 'video' && urls[r.id]
                    ? <video src={urls[r.id]} controls className="w-full h-36 object-cover bg-black" />
                    : <div className="w-full h-36 bg-[var(--color-surface)]" />}
                <div className="p-3">
                  <div className="text-xs font-semibold" style={{ color: 'var(--color-navy)' }}>{r.kind === 'photo' ? 'Photo' : 'Video'} · {(r.byteSize / 1024).toFixed(0)} KB</div>
                  {r.ocrText && <p className="mt-1 text-[11px] line-clamp-2" style={{ color: 'var(--color-warm-gray)' }}>OCR: {r.ocrText}</p>}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <button onClick={() => onAdd(r)} disabled={busy === r.id || proposals.some((proposal) => proposal.mediaId === r.id)} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-steel)' }}><Plus className="w-3.5 h-3.5" /> {proposals.some((proposal) => proposal.mediaId === r.id) ? 'Awaiting review' : 'Add to Bridge'}</button>
                    <button onClick={() => onDismiss(r)} disabled={busy === r.id || proposals.some((proposal) => proposal.mediaId === r.id)} title="Archive (soft delete)" className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg border disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pending review (the governed gate) */}
      {proposals.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--color-warm-gray)' }}>
            <ShieldCheck className="w-3.5 h-3.5" /> Pending review <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 14%, transparent)', color: 'var(--color-steel)' }}>{proposals.length}</span>
          </h3>
          <div className="flex flex-col gap-2">
            {proposals.map((p) => {
              const out = p.proposedOutput as { text?: string; candidate?: string };
              return (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border bg-white p-3" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] px-1.5 py-0.5 rounded mr-2" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy-mid)' }}>{p.resourceType}</span>
                    <span className="text-sm" style={{ color: 'var(--color-navy)' }}>{out.text}</span>
                  </div>
                  <button onClick={() => onDecide(p, 'approve')} disabled={busy === p.id} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: 'var(--success)' }}><Check className="w-3.5 h-3.5" /> Approve</button>
                  <button onClick={() => onDecide(p, 'veto')} disabled={busy === p.id} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}><Ban className="w-3.5 h-3.5" /> Veto</button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Committed (browsable) */}
      {committed.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--color-warm-gray)' }}>
            <Check className="w-3.5 h-3.5" /> Committed <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)' }}>{committed.length}</span>
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {committed.map((r) => (
              <div key={r.id} className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--color-border)' }} title={`Event · decision ${r.ledgerId ?? ''}`}>
                {urls[r.id] && (r.kind === 'photo'
                  ? <img src={urls[r.id]} alt="committed" className="w-full h-20 object-cover" />
                  : <video src={urls[r.id]} className="w-full h-20 object-cover bg-black" />)}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
