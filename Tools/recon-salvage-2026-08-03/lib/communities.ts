// Community materialiser — turns company-scope facts (clean name + LinkedIn URL,
// as produced by the LinkedIn browser extension) into Community pages.
//
// Path per distinct employer / school:
//   1. communities_canonical  (global page)        — upsert on dedup_key
//   2. communities            (per-workspace view)  — upsert (needs BRIDGE_* ids)
//   3. community_members       (person ↔ community)  — upsert, role from the label
//   + current employer also sets people.current_community_id
//
// Shared by /api/linkedin-import (runs automatically on save) and
// scripts/upsert-communities.ts (backfill from staging.jsonl).

import { createClient } from '@supabase/supabase-js';

export interface CommunityInput {
  name: string;
  url?: string;
  label: string;       // 'Employer' | 'Past Employer' | 'School' | …
  subjectName: string;
}

export interface CommunityUpsertResult {
  ok: boolean;
  upserted: number;
  associated: number;
  reason?: string;     // why nothing happened (e.g. 'no-supabase-key', 'no-input')
}

export function dedupKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function isLinkedInOrg(url?: string): boolean {
  return !!url && /linkedin\.com\/(company|school)\//i.test(url);
}

function communityKind(url: string | undefined, label: string): 'company' | 'school' {
  if ((url && /\/school\//i.test(url)) || /school|universit|college/i.test(label)) return 'school';
  return 'company';
}

function roleFromLabel(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('school') || /education|alum/.test(l)) return 'alum';
  if (l.includes('past') || l.includes('previous') || l.includes('former')) return 'former_employee';
  return 'employee';
}

export interface CommunityCanonical {
  name: string;
  kind: string;
  linkedin_url: string | null;
  description: null;
  website_url: null;
  recon_run_at: string;
  dedup_key: string;
}

export interface Association {
  commKey: string;
  subjectName: string;
  role: string;
  isCurrent: boolean;
}

/** Collapse raw company facts into distinct communities + person associations. */
export function collapseCommunities(items: CommunityInput[]): {
  list: CommunityCanonical[];
  associations: Association[];
} {
  const communities = new Map<string, CommunityCanonical>();
  const associations: Association[] = [];
  const now = new Date().toISOString();

  for (const it of items) {
    const name = (it.name ?? '').trim();
    if (!name) continue;
    const key = dedupKey(name);
    const kind = communityKind(it.url, it.label);
    const linkedin = isLinkedInOrg(it.url) ? it.url! : null;

    const existing = communities.get(key);
    if (!existing) {
      communities.set(key, {
        name, kind, linkedin_url: linkedin,
        description: null, website_url: null,
        recon_run_at: now, dedup_key: key,
      });
    } else if (!existing.linkedin_url && linkedin) {
      existing.linkedin_url = linkedin;
    }

    if (it.subjectName) {
      associations.push({
        commKey: key,
        subjectName: it.subjectName,
        role: roleFromLabel(it.label),
        isCurrent: /^(employer|current)/i.test(it.label),
      });
    }
  }

  return { list: [...communities.values()], associations };
}

/** Upsert canonical Community pages + (when BRIDGE_* ids are set) associate the person. */
export async function upsertCommunities(items: CommunityInput[]): Promise<CommunityUpsertResult> {
  const { list, associations } = collapseCommunities(items);
  if (!list.length) return { ok: true, upserted: 0, associated: 0, reason: 'no-input' };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return { ok: false, upserted: 0, associated: 0, reason: 'no-supabase-key' };

  const supabase = createClient(supabaseUrl, supabaseKey);
  const workspaceId = process.env.BRIDGE_WORKSPACE_ID;
  const userId = process.env.BRIDGE_USER_ID;
  const canAssociate = Boolean(workspaceId && userId);

  // 1. communities_canonical
  const canonCommunityId = new Map<string, string>();
  let upserted = 0;
  for (const c of list) {
    const { data, error } = await supabase
      .from('communities_canonical')
      .upsert(c, { onConflict: 'dedup_key' })
      .select('id')
      .single();
    if (error) { console.warn(`[communities] canonical "${c.name}": ${error.message}`); continue; }
    canonCommunityId.set(c.dedup_key, data!.id as string);
    upserted++;
  }

  // 2 + 3. per-workspace community + person membership
  let associated = 0;
  if (canAssociate) {
    const wsCommunityId = new Map<string, string>();
    const wsPersonId = new Map<string, string>();
    const commByKey = new Map(list.map((c) => [c.dedup_key, c]));

    // NB: `people` / `communities` have NO unique on (canonical_*, workspace, user),
    // so we select-or-insert rather than upsert. NOT-NULL columns (visibility,
    // is_user_confirmed, is_pinned_to_inner, is_muted, created_at) all have DB defaults.
    const getWsCommunity = async (commKey: string): Promise<string | null> => {
      if (wsCommunityId.has(commKey)) return wsCommunityId.get(commKey)!;
      const canonId = canonCommunityId.get(commKey);
      if (!canonId) return null;
      const { data: existing } = await supabase
        .from('communities').select('id')
        .eq('canonical_community_id', canonId).eq('workspace_id', workspaceId!).eq('user_id', userId!)
        .maybeSingle();
      let id = existing?.id as string | undefined;
      if (!id) {
        const { data, error } = await supabase
          .from('communities')
          .insert({ workspace_id: workspaceId, user_id: userId, canonical_community_id: canonId, kind: commByKey.get(commKey)!.kind, source: 'linkedin_import' })
          .select('id').single();
        if (error) { console.warn(`[communities] ws community "${commKey}": ${error.message}`); return null; }
        id = data!.id as string;
      }
      wsCommunityId.set(commKey, id);
      return id;
    };

    const getWsPerson = async (subjectName: string): Promise<string | null> => {
      const sk = dedupKey(subjectName);
      if (wsPersonId.has(sk)) return wsPersonId.get(sk)!;
      const { data: canon } = await supabase
        .from('people_canonical').select('id').eq('dedup_key', sk).maybeSingle();
      if (!canon?.id) { console.warn(`[communities] no people_canonical for "${subjectName}" — skipping association.`); return null; }
      const { data: existing } = await supabase
        .from('people').select('id')
        .eq('canonical_person_id', canon.id).eq('workspace_id', workspaceId!).eq('user_id', userId!)
        .maybeSingle();
      let id = existing?.id as string | undefined;
      if (!id) {
        const { data, error } = await supabase
          .from('people')
          .insert({ workspace_id: workspaceId, user_id: userId, canonical_person_id: canon.id, source: 'linkedin_import' })
          .select('id').single();
        if (error) { console.warn(`[communities] ws person "${subjectName}": ${error.message}`); return null; }
        id = data!.id as string;
      }
      wsPersonId.set(sk, id);
      return id;
    };

    const seen = new Set<string>();
    for (const a of associations) {
      const sig = `${dedupKey(a.subjectName)}|${a.commKey}|${a.role}`;
      if (seen.has(sig)) continue;
      seen.add(sig);

      const communityId = await getWsCommunity(a.commKey);
      const personId = await getWsPerson(a.subjectName);
      if (!communityId || !personId) continue;

      const { error: memErr } = await supabase
        .from('community_members')
        .upsert(
          { community_id: communityId, person_id: personId, role: a.role, confidence: 0.9 },
          { onConflict: 'community_id,person_id' },
        );
      if (memErr) { console.warn(`[communities] member: ${memErr.message}`); continue; }
      if (a.isCurrent) {
        await supabase.from('people').update({ current_community_id: communityId }).eq('id', personId);
      }
      associated++;
    }
  }

  return { ok: true, upserted, associated };
}
