// Supabase-backed public helpdesk surface.
// The in-app (owner) experience stays localStorage-fast; THIS module is the cross-device
// public layer so a shared `/help/:slug` link works for testers on other machines:
//   • owner (authenticated) creates an organization backed by the deployed Supabase schema
//   • anyone with the link (anon) reads public asks + posts asks/offers, gated by anon RLS.
// Every call degrades gracefully: on any error it returns null/empty so callers can fall
// back to the local store. No seed data lives here — this is the live wire.
import { supabase } from '../lib/supabase';
import { moderate, type ModerationStatus, type ContactVisibility } from './helpdesk';
import {
  HELP_DESK_ORGANIZATIONS_TABLE,
  ORGANIZATION_ID_COLUMN,
} from './helpdesk-vocab3-compat';

export interface RemoteOrganization {
  id: string; name: string; slug: string; description: string;
  visibility: 'public' | 'unlisted' | 'private'; brandColor?: string;
}
export interface RemotePublicRequest {
  id: string; title: string; body: string; status: string;
  helperCount: number; createdAt: string; allowDirectContact: boolean;
}
export interface RemoteOffer {
  id: string; helperName: string; helperEmail?: string; message: string; createdAt: string;
}

function slugify(name: string, fallback?: string): string {
  return (fallback || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
async function currentUserId(): Promise<string | null> {
  try { const { data } = await supabase.auth.getUser(); return data.user?.id ?? null; } catch { return null; }
}
function organizationRow(r: any): RemoteOrganization {
  return { id: r.id, name: r.name, slug: r.slug, description: r.description ?? '', visibility: r.visibility, brandColor: r.brand_color ?? undefined };
}

// ── owner: create + manage an organization (authenticated) ─────────────────────────
export async function remoteCreateOrganization(p: {
  name: string; description?: string; visibility: RemoteOrganization['visibility']; broadcastDefault?: boolean;
}): Promise<RemoteOrganization | null> {
  const owner = await currentUserId();
  if (!owner) return null; // not signed in → caller keeps the local-only organization
  const slug = slugify(p.name);
  const { data, error } = await supabase.from(HELP_DESK_ORGANIZATIONS_TABLE)
    .insert({ owner_id: owner, name: p.name.trim() || 'Untitled Helpdesk', slug, description: p.description || '', visibility: p.visibility, broadcast_default: p.broadcastDefault ?? false })
    .select().single();
  if (error || !data) return null;
  return organizationRow(data);
}
export async function remoteSetOrganizationVisibility(id: string, visibility: RemoteOrganization['visibility']): Promise<boolean> {
  const { error } = await supabase.from(HELP_DESK_ORGANIZATIONS_TABLE).update({ visibility }).eq('id', id);
  return !error;
}

// ── anyone with the link (anon-readable) ────────────────────────────────────────
export async function remoteOrganizationBySlug(slug: string): Promise<RemoteOrganization | null> {
  const { data, error } = await supabase.from(HELP_DESK_ORGANIZATIONS_TABLE).select('*').eq('slug', slug).maybeSingle();
  if (error || !data) return null;
  return organizationRow(data);
}
export async function remotePublicRequests(organizationId: string): Promise<RemotePublicRequest[]> {
  const { data, error } = await supabase.from('help_requests')
    .select('id,title,body,status,created_at,allow_direct_contact')
    .eq(ORGANIZATION_ID_COLUMN, organizationId).eq('is_public', true).eq('moderation_status', 'approved')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  const ids = data.map((r: any) => r.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: ofs } = await supabase.from('help_offers').select('request_id').in('request_id', ids);
    for (const o of ofs ?? []) counts[(o as any).request_id] = (counts[(o as any).request_id] || 0) + 1;
  }
  return data.map((r: any) => ({ id: r.id, title: r.title, body: r.body ?? '', status: r.status, createdAt: r.created_at, allowDirectContact: !!r.allow_direct_contact, helperCount: counts[r.id] || 0 }));
}
export async function remoteSubmitPublicRequest(p: {
  organizationId: string; name: string; email: string; phone?: string;
  title: string; body: string; allowDirectContact: boolean; contactVisibility: ContactVisibility;
}): Promise<{ ok: boolean; status: ModerationStatus; reason?: string } | null> {
  const mod = moderate(`${p.title} ${p.body}`);
  const { error } = await supabase.from('help_requests').insert({
    [ORGANIZATION_ID_COLUMN]: p.organizationId, requester_id: null,
    title: p.title.trim(), body: p.body.trim(),
    requester_name: p.name.trim(), requester_email: p.email.trim().toLowerCase(), requester_phone: p.phone?.trim() || null,
    allow_direct_contact: p.allowDirectContact, contact_visibility: p.allowDirectContact ? p.contactVisibility : 'none',
    is_public: true, routing_mode: 'broadcast', moderation_status: mod.status, moderation_reason: mod.reason ?? null,
  });
  if (error) return null; // signal caller to fall back to local
  return { ok: mod.status !== 'held', status: mod.status, reason: mod.reason };
}
export async function remoteSubmitPublicOffer(p: { requestId: string; name: string; email: string; message: string }): Promise<{ ok: boolean; status: ModerationStatus; reason?: string } | null> {
  const mod = moderate(p.message);
  if (mod.status === 'held') return { ok: false, status: mod.status, reason: mod.reason };
  const { error } = await supabase.from('help_offers').insert({
    request_id: p.requestId, helper_id: `anon:${p.email.trim().toLowerCase()}`,
    helper_name: p.name.trim(), helper_email: p.email.trim().toLowerCase(),
    message: p.message.trim(), contact_shared: false, response_private: true,
  });
  if (error) return null;
  return { ok: true, status: mod.status, reason: mod.reason };
}
export async function remoteOffersForRequest(requestId: string): Promise<RemoteOffer[]> {
  const { data, error } = await supabase.from('help_offers').select('id,helper_name,helper_email,message,created_at').eq('request_id', requestId).order('created_at', { ascending: true });
  if (error || !data) return [];
  return data.map((o: any) => ({ id: o.id, helperName: o.helper_name ?? 'Helper', helperEmail: o.helper_email ?? undefined, message: o.message ?? '', createdAt: o.created_at }));
}
