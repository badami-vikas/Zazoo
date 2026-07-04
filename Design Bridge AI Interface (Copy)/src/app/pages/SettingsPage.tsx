import { useState } from 'react';
import { Settings, Users, CreditCard, Bell, Shield, Key, ChevronRight, Upload, Check, Eye, EyeOff, Plus, Trash2, Edit2, Building2, Globe, Mail, Zap, Copy, AlertCircle, ShieldCheck, HelpCircle, BookOpen, MessageCircle, Keyboard, ExternalLink, CircleSlash } from 'lucide-react';
import clsx from 'clsx';
import { ExecutionLedger } from '../components/ExecutionLedger';

const navItems = [
  { id: 'workspace', label: 'Workspace', icon: Building2 },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'boundaries', label: 'Boundaries', icon: ShieldCheck },
  { id: 'governance', label: 'Governance', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'billing', label: 'Billing & Plan', icon: CreditCard },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'api', label: 'API Keys', icon: Key },
  { id: 'help', label: 'Help & Support', icon: HelpCircle },
];

// Org-wide default boundary rules — applied to every new profile unless overridden per-entity
// (see ItemDetail's per-person Boundaries tab). Same allow/deny shape, workspace scope.
const defaultAllowed = ['Reconnect outreach (with approval)', 'Read canonical / public facts', 'Suggest introductions (both-party consent)'];
const defaultDenied = ['Auto-send any message', 'Share private notes or warmth', 'Contact outside the trusted network'];

const teamMembers = [
  { id: 9009, name: 'dummy_Tony Stark', email: 'dummy_tony@acmecorp.com', role: 'dummy_Admin', avatar: 'T', status: 'active', lastSeen: 'dummy_9009 min ago' },
  { id: 9009, name: 'dummy_Bruce Wayne', email: 'dummy_bruce@acmecorp.com', role: 'dummy_Member', avatar: 'B', status: 'active', lastSeen: 'dummy_9009 hour ago' },
  { id: 9009, name: 'dummy_Clark Kent', email: 'dummy_clark@acmecorp.com', role: 'dummy_Member', avatar: 'C', status: 'active', lastSeen: 'dummy_9009 hours ago' },
  { id: 9009, name: 'dummy_Norman Osborn', email: 'dummy_norman@acmecorp.com', role: 'dummy_Viewer', avatar: 'N', status: 'inactive', lastSeen: 'dummy_9009 days ago' },
  { id: 9009, name: 'dummy_Miles Davis', email: 'dummy_miles@acmecorp.com', role: 'dummy_Member', avatar: 'M', status: 'active', lastSeen: 'dummy_Today' },
];

const apiKeys = [
  { id: 9009, name: 'dummy_Production Key', prefix: 'dummy_brg_live_xK8p...', created: 'dummy_9009-01-10', lastUsed: 'dummy_9009-04-08', active: true },
  { id: 9009, name: 'dummy_Development Key', prefix: 'dummy_brg_test_mN2q...', created: 'dummy_9009-02-15', lastUsed: 'dummy_9009-04-07', active: true },
  { id: 9009, name: 'dummy_Analytics Integration', prefix: 'dummy_brg_live_pR7w...', created: 'dummy_9009-03-01', lastUsed: 'dummy_9009-03-28', active: false },
];

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState('workspace');
  const [workspaceName, setWorkspaceName] = useState('dummy_Acme Corp');
  const [domain, setDomain] = useState('dummy_acmecorp.com');
  const [showApiKey, setShowApiKey] = useState<number | null>(null);
  const [members, setMembers] = useState(teamMembers);
  const [notifications, setNotifications] = useState({
    playbookRun: true,
    dealAlert: true,
    weeklyReport: true,
    aiInsights: false,
    teamActivity: true,
    integrationErrors: true,
  });
  const [twoFA, setTwoFA] = useState(true);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  const toggleNotif = (key: string) => setNotifications(n => ({ ...n, [key]: !n[key as keyof typeof n] }));

  const renderContent = () => {
    switch (activeSection) {
      case 'governance':
        return <ExecutionLedger />;

      case 'boundaries':
        return (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-lg font-bold text-[var(--color-navy)] mb-1">Boundaries</h2>
              <p className="text-sm text-[var(--color-navy-mid)]">Workspace-wide default rules applied to every profile. Any profile can add its own on top (see its Boundaries tab).</p>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'color-mix(in srgb, var(--success) 30%, var(--color-border))' }}>
                <div className="px-4 py-2.5 flex items-center gap-2 border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--success) 8%, transparent)' }}>
                  <Check className="w-4 h-4" style={{ color: 'var(--success)' }} /><span className="text-sm font-bold text-[var(--color-navy)]">Allowed by default</span>
                </div>
                <div className="p-3 flex flex-col gap-1.5">
                  {defaultAllowed.map((a, i) => <div key={i} className="text-sm text-[var(--color-navy)]">{a}</div>)}
                </div>
              </div>
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'color-mix(in srgb, var(--danger) 30%, var(--color-border))' }}>
                <div className="px-4 py-2.5 flex items-center gap-2 border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--danger) 8%, transparent)' }}>
                  <CircleSlash className="w-4 h-4" style={{ color: 'var(--danger)' }} /><span className="text-sm font-bold text-[var(--color-navy)]">Denied by default</span>
                </div>
                <div className="p-3 flex flex-col gap-1.5">
                  {defaultDenied.map((d, i) => <div key={i} className="text-sm text-[var(--color-navy)]">{d}</div>)}
                </div>
              </div>
            </div>
          </div>
        );

      case 'help':
        return (
          <div className="flex flex-col gap-8">
            <div>
              <h2 className="text-lg font-bold text-[var(--color-navy)] mb-1">Help &amp; Support</h2>
              <p className="text-sm text-[var(--color-navy-mid)]">Guides, shortcuts, and a direct line to the Bridge team.</p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { icon: BookOpen, title: 'Documentation', desc: 'Concepts, vocabulary, and how rituals, signals, and governance fit together.', cta: 'Open docs' },
                { icon: MessageCircle, title: 'Contact support', desc: 'Reach the Bridge team for setup, billing, or anything urgent.', cta: 'Start a conversation' },
                { icon: Keyboard, title: 'Keyboard shortcuts', desc: 'Move faster across the network, work, and approvals surfaces.', cta: 'View shortcuts' },
                { icon: Zap, title: 'What’s new', desc: 'Recent releases — approvals inbox, execution ledger, two-tier profiles.', cta: 'See changelog' },
              ].map(card => (
                <div key={card.title} className="flex flex-col gap-3 p-5 bg-white border border-[var(--color-border)] rounded-xl shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-9 h-9 rounded-lg bg-[var(--color-steel)]/10 flex items-center justify-center">
                    <card.icon className="w-4 h-4 text-[var(--color-steel)]" />
                  </div>
                  <div>
                    <div className="font-semibold text-[var(--color-navy)] text-sm mb-0.5">{card.title}</div>
                    <div className="text-xs text-[var(--color-navy-mid)] leading-relaxed">{card.desc}</div>
                  </div>
                  <button className="mt-auto flex items-center gap-1.5 text-xs font-semibold text-[var(--color-steel)] hover:gap-2 transition-all w-fit">
                    {card.cta} <ExternalLink className="w-3.5 h-3.5" />
                  </button>
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

      case 'workspace':
        return (
          <div className="flex flex-col gap-8">
            <div>
              <h2 className="text-lg font-bold text-[var(--color-navy)] mb-1">Workspace Settings</h2>
              <p className="text-sm text-[var(--color-navy-mid)]">Manage your organization's profile and preferences.</p>
            </div>

            {/* Logo */}
            <div className="flex items-center gap-5 p-5 bg-white border border-[var(--color-border)] rounded-xl shadow-sm">
              <div className="w-16 h-16 rounded-xl bg-[var(--color-navy)] flex items-center justify-center text-white text-2xl font-semibold shadow-md">
                A
              </div>
              <div>
                <div className="font-semibold text-[var(--color-navy)] text-sm mb-1">Workspace Logo</div>
                <div className="text-xs text-[var(--color-navy-mid)] mb-3">PNG, JPG up to 2MB. Recommended 256×256px.</div>
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface)] text-[var(--color-navy-mid)] transition-colors">
                  <Upload className="w-3.5 h-3.5" /> Upload Logo
                </button>
              </div>
            </div>

            {/* Basic Info */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--color-border)]">
                <h3 className="font-semibold text-[var(--color-navy)] text-sm">Basic Information</h3>
              </div>
              <div className="p-6 flex flex-col gap-5">
                <div>
                  <label className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wider block mb-2">Workspace Name</label>
                  <input
                    value={workspaceName}
                    onChange={e => setWorkspaceName(e.target.value)}
                    className="w-full px-4 py-2.5 border border-[var(--color-border)] rounded-lg text-sm focus:border-[var(--color-steel)] focus:ring-2 focus:ring-[var(--color-steel)]/10 outline-none transition-all bg-[var(--color-surface)] focus:bg-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wider block mb-2">Company Domain</label>
                  <div className="flex items-center">
                    <span className="px-3 py-2.5 bg-[var(--color-surface)] border border-r-0 border-[var(--color-border)] rounded-l-lg text-sm text-[var(--color-navy-mid)] font-medium"><Globe className="w-4 h-4" /></span>
                    <input
                      value={domain}
                      onChange={e => setDomain(e.target.value)}
                      className="flex-1 px-4 py-2.5 border border-[var(--color-border)] rounded-r-lg text-sm focus:border-[var(--color-steel)] focus:ring-2 focus:ring-[var(--color-steel)]/10 outline-none transition-all bg-[var(--color-surface)] focus:bg-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--color-navy-mid)] uppercase tracking-wider block mb-2">Industry</label>
                  <select className="w-full px-4 py-2.5 border border-[var(--color-border)] rounded-lg text-sm bg-[var(--color-surface)] focus:border-[var(--color-steel)] focus:ring-2 focus:ring-[var(--color-steel)]/10 outline-none transition-all focus:bg-white">
                    <option>Technology</option>
                    <option>Finance</option>
                    <option>Healthcare</option>
                    <option>Manufacturing</option>
                    <option>Professional Services</option>
                  </select>
                </div>
                <div className="flex justify-end">
                  <button className="flex items-center gap-1.5 px-4 py-2 bg-[var(--color-steel)] text-white text-sm font-semibold rounded-lg hover:bg-[var(--color-navy-mid)] transition-colors active:scale-95">
                    <Check className="w-4 h-4" /> Save Changes
                  </button>
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="border border-[var(--danger)]/30 rounded-xl bg-[var(--danger)]/10 overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--danger)]/30">
                <h3 className="font-semibold text-[var(--danger)] text-sm">Danger Zone</h3>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-[var(--color-navy)] text-sm">Delete Workspace</div>
                    <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">Permanently delete this workspace and all associated data.</div>
                  </div>
                  <button className="px-3 py-1.5 text-xs font-semibold text-[var(--danger)] border border-[var(--danger)]/30 rounded-lg hover:bg-[var(--danger)]/15 transition-colors flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5" /> Delete Workspace
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      case 'team':
        return (
          <div className="flex flex-col gap-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--color-navy)] mb-1">Team</h2>
                <p className="text-sm text-[var(--color-navy-mid)]">{members.length} members in your workspace.</p>
              </div>
              <button className="flex items-center gap-1.5 bg-[var(--color-steel)] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[var(--color-navy-mid)] transition-colors shadow-sm">
                <Plus className="w-3.5 h-3.5" /> Invite Member
              </button>
            </div>

            {/* Invite Banner */}
            <div className="flex items-center gap-4 p-4 bg-[var(--color-steel)]/5 border border-[var(--color-steel)]/20 rounded-xl">
              <div className="w-9 h-9 rounded-lg bg-[var(--color-steel)]/10 flex items-center justify-center shrink-0">
                <Mail className="w-4 h-4 text-[var(--color-steel)]" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--color-navy)]">Invite via email or link</div>
                <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">Share a magic invite link or send email invitations.</div>
              </div>
              <button className="px-3 py-1.5 text-xs font-semibold text-[var(--color-steel)] border border-[var(--color-steel)]/30 rounded-lg hover:bg-[var(--color-steel)]/10 transition-colors flex items-center gap-1.5">
                <Copy className="w-3.5 h-3.5" /> Copy Invite Link
              </button>
            </div>

            {/* Members Table */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-[var(--color-surface)] border-b border-[var(--color-border)]">
                  <tr>
                    <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider">Member</th>
                    <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider">Role</th>
                    <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider">Last Active</th>
                    <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] transition-colors group">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-steel)]/40 to-[var(--color-steel)]/20 flex items-center justify-center text-[var(--color-steel)] text-xs font-bold shrink-0">
                            {m.avatar}
                          </div>
                          <div>
                            <div className="font-semibold text-[var(--color-navy)]">{m.name}</div>
                            <div className="text-xs text-[var(--color-warm-gray)]">{m.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <select
                          defaultValue={m.role}
                          className="bg-transparent text-sm font-medium text-[var(--color-navy-mid)] border border-transparent hover:border-[var(--color-border)] rounded-md px-1 py-0.5 focus:outline-none focus:border-[var(--color-steel)] focus:ring-1 focus:ring-[var(--color-steel)] cursor-pointer"
                        >
                          <option>Admin</option>
                          <option>Member</option>
                          <option>Viewer</option>
                        </select>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={clsx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium', m.status === 'active' ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--color-surface)] text-[var(--color-navy-mid)]')}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', m.status === 'active' ? 'bg-[var(--success)]' : 'bg-[var(--color-warm-gray)]')} />
                          {m.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[var(--color-warm-gray)] font-mono">{m.lastSeen}</td>
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => setMembers(ms => ms.filter(x => x.id !== m.id))}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-[var(--color-warm-gray)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-all"
                          title="Remove member"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="flex flex-col gap-8">
            <div>
              <h2 className="text-lg font-bold text-[var(--color-navy)] mb-1">Notification Preferences</h2>
              <p className="text-sm text-[var(--color-navy-mid)]">Choose how and when Bridge AI notifies you.</p>
            </div>

            {[
              { key: 'playbookRun', label: 'Ritual Completed', desc: 'Notify when a ritual finishes running for a person', category: 'Rituals' },
              { key: 'dealAlert', label: 'Initiative Stage Changes', desc: 'Alert when an Initiative advances to a new stage', category: 'Initiatives' },
              { key: 'weeklyReport', label: 'Weekly Performance Report', desc: 'Summary of initiative, rituals, and AI insights every Monday', category: 'Reports' },
              { key: 'aiInsights', label: 'AI Proactive Insights', desc: 'Allow Bridge AI to push unsolicited recommendations', category: 'AI' },
              { key: 'teamActivity', label: 'Team Activity', desc: 'Notify when teammates add notes, update records, or complete touchpoints', category: 'Team' },
              { key: 'integrationErrors', label: 'App Errors', desc: 'Alert when a connected app fails or requires attention', category: 'System' },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between p-5 bg-white border border-[var(--color-border)] rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-[var(--color-navy)] text-sm">{item.label}</span>
                    <span className="px-1.5 py-0.5 bg-[var(--color-surface)] text-[var(--color-navy-mid)] text-xs font-medium rounded">{item.category}</span>
                  </div>
                  <div className="text-xs text-[var(--color-navy-mid)]">{item.desc}</div>
                </div>
                <button
                  onClick={() => toggleNotif(item.key)}
                  className={clsx(
                    'relative w-11 h-6 rounded-full transition-all duration-200 shrink-0',
                    notifications[item.key as keyof typeof notifications] ? 'bg-[var(--color-steel)]' : 'bg-[var(--color-border)]'
                  )}
                >
                  <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200', notifications[item.key as keyof typeof notifications] ? 'translate-x-5' : 'translate-x-0')} />
                </button>
              </div>
            ))}
          </div>
        );

      case 'billing':
        return (
          <div className="flex flex-col gap-8">
            <div>
              <h2 className="text-lg font-bold text-[var(--color-navy)] mb-1">Billing & Plan</h2>
              <p className="text-sm text-[var(--color-navy-mid)]">Manage your subscription and payment details.</p>
            </div>

            {/* Current Plan */}
            <div className="bg-gradient-to-br from-[var(--color-steel)] to-[var(--color-navy-mid)] rounded-2xl p-6 text-white shadow-lg shadow-[var(--color-steel)]/20">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-widest opacity-70 mb-1">Current Plan</div>
                  <div className="text-2xl font-semibold">dummy_Enterprise</div>
                </div>
                <div className="px-3 py-1.5 bg-white/20 rounded-lg text-xs font-bold uppercase tracking-wider">Active</div>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-5">
                {[
                  { label: 'Users', value: 'dummy_9009 / 9009' },
                  { label: 'Rituals', value: 'dummy_9009 / Unlimited' },
                  { label: 'AI Credits', value: 'dummy_9009 / 9009' },
                ].map(m => (
                  <div key={m.label}>
                    <div className="font-bold">{m.value}</div>
                    <div className="text-xs opacity-70">{m.label}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button className="px-4 py-2 bg-white text-[var(--color-steel)] text-xs font-bold rounded-lg hover:bg-[var(--color-surface)] transition-colors">
                  Manage Plan
                </button>
                <button className="px-4 py-2 bg-white/20 text-white text-xs font-semibold rounded-lg hover:bg-white/30 transition-colors">
                  View Invoices
                </button>
              </div>
            </div>

            {/* Billing Info */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
                <h3 className="font-semibold text-[var(--color-navy)] text-sm">Payment Method</h3>
                <button className="text-xs font-semibold text-[var(--color-steel)] hover:underline">Update</button>
              </div>
              <div className="p-6 flex items-center gap-4">
                <div className="w-14 h-10 rounded-lg bg-[var(--color-navy)] flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-semibold text-[var(--color-navy)] text-sm">•••• •••• •••• 9009</div>
                  <div className="text-xs text-[var(--color-navy-mid)]">Expires 9009/9009 · Visa</div>
                </div>
                <span className="ml-auto px-2 py-0.5 bg-[var(--success)]/10 text-[var(--success)] text-xs font-semibold rounded border border-[var(--success)]/30">Default</span>
              </div>
            </div>

            {/* Next Invoice */}
            <div className="flex items-center gap-4 p-5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl">
              <AlertCircle className="w-5 h-5 text-[var(--warning)] shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-navy)] text-sm">Next Invoice</div>
                <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">$9,009.00 due on May 9009, 9009 for dummy_Enterprise plan (annual).</div>
              </div>
            </div>
          </div>
        );

      case 'security':
        return (
          <div className="flex flex-col gap-8">
            <div>
              <h2 className="text-lg font-bold text-[var(--color-navy)] mb-1">Security</h2>
              <p className="text-sm text-[var(--color-navy-mid)]">Manage authentication and access controls.</p>
            </div>

            {[
              {
                title: 'Two-Factor Authentication',
                desc: 'Require all team members to verify their identity with a second factor.',
                enabled: twoFA,
                toggle: () => setTwoFA(!twoFA),
                badge: twoFA ? { label: 'Recommended', cls: 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/30' } : null,
              },
              {
                title: 'SSO / SAML',
                desc: 'Enable single sign-on via your identity provider (Okta, Azure AD, etc.).',
                enabled: ssoEnabled,
                toggle: () => setSsoEnabled(!ssoEnabled),
                badge: null,
              },
            ].map(setting => (
              <div key={setting.title} className="flex items-center justify-between p-5 bg-white border border-[var(--color-border)] rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-[var(--color-navy)] text-sm">{setting.title}</span>
                    {setting.badge && (
                      <span className={clsx('px-1.5 py-0.5 text-xs font-semibold rounded border', setting.badge.cls)}>{setting.badge.label}</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-navy-mid)]">{setting.desc}</div>
                </div>
                <button
                  onClick={setting.toggle}
                  className={clsx('relative w-11 h-6 rounded-full transition-all duration-200 shrink-0', setting.enabled ? 'bg-[var(--color-steel)]' : 'bg-[var(--color-border)]')}
                >
                  <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200', setting.enabled ? 'translate-x-5' : 'translate-x-0')} />
                </button>
              </div>
            ))}

            {/* Session Management */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--color-border)]">
                <h3 className="font-semibold text-[var(--color-navy)] text-sm">Active Sessions</h3>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {[
                  { device: 'dummy_MacBook Pro 9009"', location: 'dummy_San Francisco, CA', current: true, time: 'dummy_Active now' },
                  { device: 'dummy_iPhone 9009 Pro', location: 'dummy_San Francisco, CA', current: false, time: 'dummy_9009 hours ago' },
                ].map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-6 py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[var(--color-navy)] text-sm">{s.device}</span>
                        {s.current && <span className="px-1.5 py-0.5 bg-[var(--success)]/10 text-[var(--success)] text-xs font-semibold rounded">Current</span>}
                      </div>
                      <div className="text-xs text-[var(--color-warm-gray)] mt-0.5">{s.location} · {s.time}</div>
                    </div>
                    {!s.current && (
                      <button className="text-xs font-semibold text-[var(--danger)] hover:text-[var(--danger)] transition-colors">Revoke</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case 'api':
        return (
          <div className="flex flex-col gap-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--color-navy)] mb-1">API Keys</h2>
                <p className="text-sm text-[var(--color-navy-mid)]">Manage API keys for programmatic access to Bridge AI.</p>
              </div>
              <button className="flex items-center gap-1.5 bg-[var(--color-steel)] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[var(--color-navy-mid)] transition-colors shadow-sm">
                <Plus className="w-3.5 h-3.5" /> Generate New Key
              </button>
            </div>

            {/* Info Banner */}
            <div className="flex items-start gap-3 p-4 bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-xl">
              <AlertCircle className="w-4 h-4 text-[var(--warning)] shrink-0 mt-0.5" />
              <div className="text-xs text-[var(--warning)]">
                <span className="font-semibold">Keep your API keys secret.</span> Do not share them in public repositories or client-side code. Treat them like passwords.
              </div>
            </div>

            {/* API Keys List */}
            <div className="bg-white border border-[var(--color-border)] rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-[var(--color-surface)] border-b border-[var(--color-border)]">
                  <tr>
                    <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider">Name</th>
                    <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider">Key</th>
                    <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider">Last Used</th>
                    <th className="px-5 py-3 font-semibold text-xs text-[var(--color-navy-mid)] uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map(key => (
                    <tr key={key.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] transition-colors group">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-[var(--color-navy)]">{key.name}</div>
                        <div className="text-xs text-[var(--color-warm-gray)] mt-0.5">Created {key.created}</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono bg-[var(--color-surface)] px-2 py-1 rounded text-[var(--color-navy-mid)]">
                            {showApiKey === key.id ? 'dummy_brg_live_xK8pMn2qR7wAbCd1EfGh3IjKl4' : key.prefix}
                          </code>
                          <button onClick={() => setShowApiKey(showApiKey === key.id ? null : key.id)} className="p-1 text-[var(--color-warm-gray)] hover:text-[var(--color-navy-mid)] transition-colors">
                            {showApiKey === key.id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button className="p-1 text-[var(--color-warm-gray)] hover:text-[var(--color-steel)] transition-colors" title="Copy">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={clsx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium', key.active ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--color-surface)] text-[var(--color-warm-gray)]')}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', key.active ? 'bg-[var(--success)]' : 'bg-[var(--color-warm-gray)]')} />
                          {key.active ? 'Active' : 'Revoked'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-[var(--color-warm-gray)] font-mono">{key.lastUsed}</td>
                      <td className="px-5 py-4">
                        <button className="opacity-0 group-hover:opacity-100 text-xs font-semibold text-[var(--danger)] hover:text-[var(--danger)] transition-all px-2 py-1 rounded hover:bg-[var(--danger)]/10">
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Docs Link */}
            <div className="flex items-center gap-4 p-5 bg-[var(--color-steel)]/5 border border-[var(--color-steel)]/10 rounded-xl">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-steel)]/10 flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5 text-[var(--color-steel)]" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-[var(--color-navy)] text-sm">Bridge AI REST API</div>
                <div className="text-xs text-[var(--color-navy-mid)] mt-0.5">Programmatic access to records, rituals, AI inference, and more.</div>
              </div>
              <button className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-steel)] border border-[var(--color-steel)]/30 px-3 py-1.5 rounded-lg hover:bg-[var(--color-steel)]/10 transition-colors">
                View Docs <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );

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
            <p className="text-xs text-[var(--color-navy-mid)]">Workspace configuration & preferences</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Nav */}
        <div className="w-56 shrink-0 bg-white border-r border-[var(--color-border)] flex flex-col overflow-y-auto">
          <nav className="p-3 flex flex-col gap-1">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left',
                  activeSection === item.id
                    ? 'bg-[var(--color-steel)]/10 text-[var(--color-steel)]'
                    : 'text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)] hover:text-[var(--color-navy)]'
                )}
              >
                <item.icon className={clsx('w-4 h-4 shrink-0', activeSection === item.id ? 'text-[var(--color-steel)]' : 'text-[var(--color-warm-gray)]')} />
                {item.label}
                {activeSection === item.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--color-steel)]" />}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className={clsx('mx-auto', activeSection === 'governance' ? 'max-w-5xl' : activeSection === 'boundaries' ? 'max-w-3xl' : 'max-w-2xl')}>
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
