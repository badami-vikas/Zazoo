// Workspace + Team management, available from every standalone tool shell (StandaloneLayout).
// Real backend-persisted (Supabase, via apps/api's workspace.* tRPC procedures) — not a local
// mock round-trip like much of this prototype. Falls back to a connect-the-API message when
// VITE_API_URL isn't set, matching every other API_ENABLED-gated surface in this app.
import { useEffect, useState } from 'react';
import { Building2, Users, Plus, X, Loader2 } from 'lucide-react';
import { API_ENABLED, apiListWorkspaces, apiCreateWorkspace, apiListMembers, apiInviteMember, type WorkspaceDTO, type WorkspaceMemberDTO } from '../../data/api';

type Tab = 'workspace' | 'team';

export function WorkspaceTeamModal({ initialTab, onClose }: { initialTab: Tab; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [workspaces, setWorkspaces] = useState<WorkspaceDTO[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  async function refreshWorkspaces() {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiListWorkspaces();
      if (rows) {
        setWorkspaces(rows);
        setSelected((prev) => prev ?? rows[0]?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }

  async function refreshMembers(workspaceId: string) {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiListMembers(workspaceId);
      if (rows) setMembers(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (API_ENABLED) refreshWorkspaces(); }, []);
  useEffect(() => { if (API_ENABLED && selected) refreshMembers(selected); }, [selected]);

  async function createWorkspace() {
    if (!newWorkspaceName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const ws = await apiCreateWorkspace(newWorkspaceName.trim());
      setNewWorkspaceName('');
      if (ws) { setWorkspaces((prev) => [...prev, ws]); setSelected(ws.id); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create organization');
    } finally {
      setLoading(false);
    }
  }

  async function inviteMember() {
    if (!inviteEmail.trim() || !selected) return;
    setLoading(true);
    setError(null);
    try {
      await apiInviteMember(selected, inviteEmail.trim());
      setInviteEmail('');
      await refreshMembers(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to invite teammate');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-sm font-bold flex-1" style={{ color: 'var(--color-navy)' }}>Organization &amp; Team</span>
          <button onClick={onClose}><X className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} /></button>
        </div>

        <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={() => setTab('workspace')} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium" style={{ color: tab === 'workspace' ? 'var(--color-steel)' : 'var(--color-warm-gray)', borderBottom: tab === 'workspace' ? '2px solid var(--color-steel)' : '2px solid transparent' }}>
            <Building2 className="w-3.5 h-3.5" /> Organization
          </button>
          <button onClick={() => setTab('team')} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium" style={{ color: tab === 'team' ? 'var(--color-steel)' : 'var(--color-warm-gray)', borderBottom: tab === 'team' ? '2px solid var(--color-steel)' : '2px solid transparent' }}>
            <Users className="w-3.5 h-3.5" /> Team
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3 min-h-[240px]">
          {!API_ENABLED ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 py-8 text-center">
              <span className="text-sm font-medium" style={{ color: 'var(--color-navy)' }}>Connect the platform API</span>
              <span className="text-xs max-w-xs" style={{ color: 'var(--color-warm-gray)' }}>Organization and team management is real, backend-persisted data — set <code>VITE_API_URL</code> to manage it here.</span>
            </div>
          ) : tab === 'workspace' ? (
            <>
              <div className="flex gap-1.5">
                <input value={newWorkspaceName} onChange={(e) => setNewWorkspaceName(e.target.value)} placeholder="New organization name" className="flex-1 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--color-border)' }} onKeyDown={(e) => e.key === 'Enter' && createWorkspace()} />
                <button onClick={createWorkspace} disabled={loading || !newWorkspaceName.trim()} className="px-3 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40" style={{ backgroundColor: 'var(--color-steel)' }}>
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {workspaces.map((ws) => (
                  <button key={ws.id} onClick={() => setSelected(ws.id)} className="flex items-center justify-between px-3 py-2 rounded-lg border text-sm text-left" style={{ borderColor: selected === ws.id ? 'var(--color-steel)' : 'var(--color-border)', backgroundColor: selected === ws.id ? 'color-mix(in srgb, var(--color-steel) 8%, white)' : 'white', color: 'var(--color-navy)' }}>
                    <span>{ws.name}</span>
                    {selected === ws.id && <span className="text-[10px] font-semibold" style={{ color: 'var(--color-steel)' }}>Active</span>}
                  </button>
                ))}
                {workspaces.length === 0 && !loading && <span className="text-xs text-center py-4" style={{ color: 'var(--color-warm-gray)' }}>No organizations yet — create one above.</span>}
              </div>
            </>
          ) : (
            <>
              {!selected ? (
                <span className="text-xs text-center py-4" style={{ color: 'var(--color-warm-gray)' }}>Create or select an organization first.</span>
              ) : (
                <>
                  <div className="flex gap-1.5">
                    <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@company.com" type="email" className="flex-1 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--color-border)' }} onKeyDown={(e) => e.key === 'Enter' && inviteMember()} />
                    <button onClick={inviteMember} disabled={loading || !inviteEmail.trim()} className="px-3 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40" style={{ backgroundColor: 'var(--color-steel)' }}>
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {members.map((m) => (
                      <div key={m.userId} className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--color-border)' }}>
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: 'var(--color-steel)' }}>{(m.name ?? m.email).charAt(0).toUpperCase()}</span>
                        <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--color-navy)' }}>{m.name ?? m.email}</span>
                        <span className="text-xs truncate" style={{ color: 'var(--color-warm-gray)' }}>{m.email}</span>
                      </div>
                    ))}
                    {members.length === 0 && !loading && <span className="text-xs text-center py-4" style={{ color: 'var(--color-warm-gray)' }}>No teammates yet — invite one above.</span>}
                  </div>
                </>
              )}
            </>
          )}
          {loading && <Loader2 className="w-4 h-4 animate-spin mx-auto" style={{ color: 'var(--color-steel)' }} />}
          {error && <span className="text-xs text-center" style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>
      </div>
    </div>
  );
}
