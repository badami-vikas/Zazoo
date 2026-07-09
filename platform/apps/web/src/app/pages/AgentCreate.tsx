import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronRight, BookOpen, Bot, Save, ArrowLeft } from 'lucide-react';
import { PermissionLayers, type PermissionState } from '../components/PermissionLayers';
import { apiCreateAgent, API_ENABLED } from '../data/api';

// Agent creation — name, specialization, model, then the LAYERED PERMISSIONS section.
// Form starts empty / least-privilege (no dummy data). When the API is off, creation
// no-ops through the helper and we navigate back; the layered controls stay demoable.

const MODEL_OPTIONS = [
  'ModelProvider (local default)',
  'Claude (default)',
  'Ollama (dev)',
];

export function AgentCreate() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [model, setModel] = useState(MODEL_OPTIONS[0]);
  const [saving, setSaving] = useState(false);

  // Least-privilege starting point: no tokens, no skills, public ceiling, no egress.
  const [perms, setPerms] = useState<PermissionState>({
    capabilityScope: [],
    allowedSkills: [],
    dataScope: 'public',
    egressTier: 'none',
  });

  const canSave = name.trim().length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await apiCreateAgent({
        name: name.trim(),
        capabilityScope: perms.capabilityScope,
        allowedSkills: perms.allowedSkills,
        dataScope: perms.dataScope,
        egressTier: perms.egressTier,
      });
    } catch {
      // Swallow transport errors in the demo; local-state fallback keeps the UI usable.
    } finally {
      setSaving(false);
      navigate('/intelligence');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">

      {/* ── Header ─── */}
      <div className="border-b border-[var(--color-border)] shrink-0 bg-white z-20">
        <div className="h-10 flex items-center px-6 border-b border-[var(--color-border)] gap-2 text-sm">
          <BookOpen className="w-3.5 h-3.5 text-[var(--color-steel)]" />
          <Link to="/intelligence" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">Intelligence</Link>
          <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
          <Link to="/intelligence" className="text-[var(--color-navy-mid)] hover:text-[var(--color-navy)] transition-colors">Agents</Link>
          <ChevronRight className="w-3 h-3 text-[var(--color-warm-gray)]" />
          <span className="bg-[var(--color-steel)]/8 text-[var(--color-steel)] px-2.5 py-0.5 rounded text-xs font-semibold">New agent</span>
        </div>
        <div className="h-10 flex items-center justify-between px-6">
          <Link to="/intelligence" className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="flex items-center gap-1.5 bg-[var(--color-steel)] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[var(--color-navy-mid)] transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? 'Creating…' : 'Create Agent'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-8 py-10 flex flex-col gap-10 pb-32">

          {/* Hero */}
          <div className="flex items-start gap-5">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-[var(--color-steel)]/20 shrink-0" style={{ background: 'linear-gradient(135deg, var(--color-steel), color-mix(in srgb, var(--color-steel) 80%, black))' }}>
              <Bot className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-navy)]">Create an agent</h1>
              <p className="text-sm text-[var(--color-navy-mid)] mt-1 max-w-xl">
                In-platform agents draft only — they never send and never approve. Grant authority in layers,
                least-privilege first. Each layer you open widens what this agent may do.
              </p>
            </div>
          </div>

          {/* Identity */}
          <section className="flex flex-col gap-4">
            <h2 className="font-bold text-[var(--color-navy)] border-b border-[var(--color-border)] pb-3">Identity</h2>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-[var(--color-navy)]">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Reconnect Strategist"
                className="text-sm rounded-lg border border-[var(--color-border)] px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-steel)]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-[var(--color-navy)]">Specialization</label>
              <input
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                placeholder="e.g. Dormant tie reconnection"
                className="text-sm rounded-lg border border-[var(--color-border)] px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-steel)]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-[var(--color-navy)]">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="text-sm font-medium rounded-lg border border-[var(--color-border)] px-3 py-2 bg-[var(--color-surface)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--color-steel)] w-full sm:w-auto"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </section>

          {/* Layered permissions */}
          <section className="flex flex-col gap-4">
            <div className="border-b border-[var(--color-border)] pb-3">
              <h2 className="font-bold text-[var(--color-navy)]">Layered permissions</h2>
              <p className="text-xs text-[var(--color-navy-mid)] mt-0.5">
                Gated like incremental OAuth scopes — grant only what this agent needs. The effective summary recomputes as you go.
              </p>
            </div>
            <PermissionLayers value={perms} onChange={setPerms} />
          </section>

          {!API_ENABLED && (
            <p className="text-xs text-[var(--color-warm-gray)] text-center">
              Backend not connected — this agent is created in local state for the demo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
