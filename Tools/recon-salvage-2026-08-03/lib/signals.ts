// Unified approval surface — recon gates → Bridge AI Signals.
//
// Every draft-then-approve gate (recon promotion, entity-merge, ad-hoc data ops)
// is published as a row in the shared Supabase `signals` table. Bridge's Signals
// page renders it; on approval Bridge calls POST /api/signals/[id]/apply, which
// runs applySignal() here — the privileged write with the SERVICE key (never the
// RLS-bound browser). See docs/raw/signals-approval-surface.md.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { promoteStaging, storeStatus } from './store';

const WORKSPACE = process.env.BRIDGE_WORKSPACE_ID || 'b0000000-0000-4000-a000-000000000001';
// `signals.subject_id` is a uuid; recon-store / data-op subjects aren't real entities,
// so they use stable synthetic uuids (constant → publishSignal upsert stays idempotent).
const RECON_STORE_SUBJECT = 'c0ffee00-0000-4000-a000-000000005706';

export type SignalType =
  | 'recon.promotion'
  | 'recon.entity_merge'
  | 'data.eta_replace'
  | 'data.company_cleanup'
  | 'data.company_merge';

export type SignalStatus = 'new' | 'approved' | 'applied' | 'dismissed' | 'error';

export interface SignalRow {
  id?: string;
  workspace_id?: string;
  subject_type: string;
  subject_id: string;
  type: SignalType;
  payload: Record<string, unknown>;
  recommended_action: {
    verb: string;
    label: string;
    description: string;
    apply: { tool: 'recon'; op: SignalType };
  };
  status?: SignalStatus;
}

export interface ApplyResult {
  ok: boolean;
  status: SignalStatus;
  detail?: string;
  error?: string;
}

function admin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Publish / list ──────────────────────────────────────────────────────────────

/** Upsert a signal. Re-publishing the same (workspace,type,subject) refreshes it
 *  unless it's already been applied (terminal) — avoids resurrecting done work. */
export async function publishSignal(sig: SignalRow): Promise<{ id: string } | null> {
  const sb = admin();
  const { data: existing } = await sb
    .from('signals')
    .select('id, status')
    .eq('workspace_id', sig.workspace_id || WORKSPACE)
    .eq('type', sig.type)
    .eq('subject_id', sig.subject_id)
    .maybeSingle();

  if (existing && (existing.status === 'applied' || existing.status === 'dismissed')) {
    return { id: existing.id as string };
  }
  if (existing) {
    await sb.from('signals').update({ payload: sig.payload, recommended_action: sig.recommended_action, status: 'new' }).eq('id', existing.id);
    return { id: existing.id as string };
  }
  const { data, error } = await sb
    .from('signals')
    .insert({
      workspace_id: sig.workspace_id || WORKSPACE,
      subject_type: sig.subject_type,
      subject_id: sig.subject_id,
      type: sig.type,
      payload: sig.payload,
      recommended_action: sig.recommended_action,
      status: 'new',
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

export async function listSignals(status?: SignalStatus) {
  const sb = admin();
  let q = sb.from('signals').select('*').eq('workspace_id', WORKSPACE).order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ── Recon gate → signal ───────────────────────────────────────────────────────────

/** Publish (or refresh) the staging→permanent promotion gate as a signal when the
 *  recon store has crossed its approval threshold. Returns the signal id or null. */
export async function syncReconGates(): Promise<{ promotion?: string }> {
  const st = await storeStatus();
  const out: { promotion?: string } = {};
  if (st.needsApproval) {
    const r = await publishSignal({
      subject_type: 'recon_store',
      subject_id: RECON_STORE_SUBJECT,
      type: 'recon.promotion',
      payload: {
        stagingCount: st.stagingCount,
        subjectCount: st.subjectCount,
        permanentCount: st.permanentCount,
        threshold: st.threshold,
        preview: `${st.stagingCount} staged facts across ${st.subjectCount} subjects ready to commit to the permanent recon store.`,
      },
      recommended_action: {
        verb: 'Promote staged facts',
        label: `Commit ${st.stagingCount} staged facts`,
        description: `Dedupe and commit ${st.stagingCount} staged recon facts (${st.subjectCount} subjects) to the permanent store. Flagged rows are excluded.`,
        apply: { tool: 'recon', op: 'recon.promotion' },
      },
    });
    if (r) out.promotion = r.id;
  }
  return out;
}

// ── Apply (executor) ──────────────────────────────────────────────────────────────

/** Run a data-processing op via the SECURITY DEFINER dispatcher RPC, using the
 *  service-key client. No `pg`/DATABASE_URL — mirrors the apply_dedup_signal pattern.
 *  The function (db/migrations: apply_data_signal) reads the signal's payload and
 *  performs the delete/insert/update server-side, returning a jsonb result. */
async function runDataOp(sb: SupabaseClient, signalId: string): Promise<string> {
  const { data, error } = await sb.rpc('apply_data_signal', { p_signal_id: signalId });
  if (error) throw new Error(error.message);
  return typeof data === 'string' ? data : JSON.stringify(data);
}

/** Apply an approved signal. Idempotent: already-applied returns ok no-op. */
export async function applySignal(id: string): Promise<ApplyResult> {
  const sb = admin();
  const { data: sig, error } = await sb.from('signals').select('*').eq('id', id).single();
  if (error || !sig) return { ok: false, status: 'error', error: 'signal not found' };
  if (sig.status === 'applied') return { ok: true, status: 'applied', detail: 'already applied' };

  try {
    let detail = '';
    switch (sig.type as SignalType) {
      case 'recon.promotion': {
        const r = await promoteStaging();
        detail = `promoted ${r.promoted}, skipped ${r.skipped}`;
        break;
      }
      case 'data.eta_replace':
      case 'data.company_cleanup':
      case 'data.company_merge': {
        // All data ops dispatch to the SECURITY DEFINER apply_data_signal RPC, which
        // reads this signal's payload and performs the mutation server-side.
        detail = await runDataOp(sb, id);
        break;
      }
      case 'recon.entity_merge': {
        // entity-merge handler: apply the confirmed grouping (see store.recordEntityLink)
        throw new Error('recon.entity_merge apply not yet implemented');
      }
      default:
        throw new Error(`unknown signal type: ${sig.type}`);
    }
    await sb.from('signals').update({ status: 'applied', payload: { ...sig.payload, applied_detail: detail } }).eq('id', id);
    return { ok: true, status: 'applied', detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'apply failed';
    await sb.from('signals').update({ status: 'error', payload: { ...sig.payload, error: msg } }).eq('id', id);
    return { ok: false, status: 'error', error: msg };
  }
}

export async function dismissSignal(id: string): Promise<ApplyResult> {
  const sb = admin();
  const { error } = await sb.from('signals').update({ status: 'dismissed' }).eq('id', id);
  return error ? { ok: false, status: 'error', error: error.message } : { ok: true, status: 'dismissed' };
}
