import { useEffect, useRef, useState } from 'react';
import type { CardData } from './types';
import { contactCount, downloadCSV, loadContacts, saveContact, splitPair } from './storage';
import { feedbackCount, loadFeedback, saveFeedback } from './feedback';
import { addToBridge, mapCardToCapture, outboxCount } from './bridge';
import { scanCard, type StepLog } from './scan';

// ── Settings ──────────────────────────────────────────────────────────────────

type AISource = 'ollama' | 'groq' | 'gemini';

interface AppSettings {
  source: AISource;
  ollamaUrl: string;
  groqKey: string;
  geminiKey: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  // Default = Groq (free, browser-callable vision) so the scanner works on the Bridge
  // origin and on a public deploy with a key. Ollama (local/private) + Gemini stay in
  // settings. Paste a free console.groq.com key in the scanner's AI Engine panel.
  source:    'groq',
  ollamaUrl: 'http://localhost:11434',
  groqKey:   '',
  geminiKey: '',
};

const SETTINGS_KEY = 'card-scanner-settings-v1';
const FILE_KEY     = 'card-scanner-filename-v1';

function loadAppSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; }
  catch { return DEFAULT_SETTINGS; }
}
function saveAppSettings(s: AppSettings) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

const SOURCE_LABELS: Record<AISource, string> = {
  ollama: 'Ollama',
  groq:   'Groq',
  gemini: 'Gemini Flash',
};

// ── Types ─────────────────────────────────────────────────────────────────────

type JobStatus = 'queued' | 'processing' | 'review' | 'saved' | 'error';
type ScanPhase = 'searching' | 'locking' | 'captured' | 'cooldown';

interface EmailInsight {
  nameConfirmed?:    boolean;
  nameFromEmail?:    string;
  companyConfirmed?: boolean;
  companyFromEmail?: string;
}

interface CardJob {
  id:             string;
  imageUrl:       string;
  status:         JobStatus;
  fields:         CardData;
  originalFields?: CardData;
  insight?:       EmailInsight;
  model?:         string;
  source?:        string;
  steps?:         StepLog[];
  error?:         string;
  editing?:       boolean;
  showBreakdown?: boolean;
  showFeedback?:  boolean;
  feedbackDone?:  boolean;
}

const EMPTY: CardData = { name: '', role: '', company: '', email: '', phone: '', address: '', website: '', additional: '' };

const CARD_FIELDS: Array<{ k: keyof CardData; label: string; ph: string; multi?: boolean }> = [
  { k: 'name',       label: 'Name',        ph: 'Full name' },
  { k: 'role',       label: 'Role / Title', ph: 'Job title' },
  { k: 'company',    label: 'Company',      ph: 'Organisation' },
  { k: 'email',      label: 'Email',        ph: 'email@example.com' },
  { k: 'phone',      label: 'Phone',        ph: '+1 234 567 8900' },
  { k: 'address',    label: 'Address',      ph: '123 Main St, City, Country', multi: true },
  { k: 'website',    label: 'Website',      ph: 'https://example.com' },
  { k: 'additional', label: 'Additional',   ph: 'Social handles, fax, tagline…', multi: true },
];

// ── Image compression ─────────────────────────────────────────────────────────

async function compressForAPI(url: string): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.crossOrigin = 'anonymous';
    i.onload = () => res(i); i.onerror = rej; i.src = url;
  });
  const MAX = 1600;
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > MAX || h > MAX) { const r = Math.min(MAX / w, MAX / h); w = Math.round(w * r); h = Math.round(h * r); }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return { base64: canvas.toDataURL('image/jpeg', 0.88).split(',')[1], mediaType: 'image/jpeg' };
}

// ── Email enrichment ──────────────────────────────────────────────────────────

const GENERIC_LOCALS   = new Set(['info','contact','support','hello','admin','sales','hr','marketing','team',
  'mail','office','noreply','no-reply','enquiry','enquiries','help','service','services','inquiry','media',
  'press','care','webmaster','billing']);
const PERSONAL_DOMAINS = new Set(['gmail','yahoo','hotmail','outlook','icloud','protonmail','aol','me',
  'live','msn','mail','ymail','zoho']);

function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function looseSimilar(a: string, b: string) {
  if (!a || !b) return false;
  const na = norm(a), nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na) ||
    a.toLowerCase().split(/\s+/).filter(w => w.length > 2).some(w => nb.includes(w));
}
function localToName(l: string) {
  return l.replace(/[._\-+]/g, ' ').replace(/\d+$/, '').trim()
    .split(/\s+/).filter(w => w.length > 1).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
function domainToCompany(d: string) {
  return d.split('.')[0].replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
function enrichWithEmail(fields: CardData): CardData & { insight: EmailInsight } {
  const insight: EmailInsight = {};
  const at = (fields.email || '').split(' | ')[0].indexOf('@');
  if (at === -1) return { ...fields, insight };
  const local = fields.email.slice(0, at), domain = fields.email.slice(at + 1);
  const base  = domain.split('.')[0].toLowerCase();
  if (!GENERIC_LOCALS.has(local.toLowerCase()) && local.length > 2) {
    const c = localToName(local);
    if (c.includes(' ') || c.length > 3) {
      if (!fields.name) insight.nameFromEmail = c;
      else if (looseSimilar(fields.name, c)) insight.nameConfirmed = true;
    }
  }
  if (!PERSONAL_DOMAINS.has(base)) {
    const c = domainToCompany(domain);
    if (!fields.company) insight.companyFromEmail = c;
    else if (looseSimilar(fields.company, c)) insight.companyConfirmed = true;
  }
  return { ...fields, name: fields.name || insight.nameFromEmail || '', company: fields.company || insight.companyFromEmail || '', insight };
}

// ── SettingsPanel ─────────────────────────────────────────────────────────────

function SettingsPanel({ init, onSave, onClose }: { init: AppSettings; onSave: (s: AppSettings) => void; onClose: () => void }) {
  const [d, setD] = useState<AppSettings>({ ...init });
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-700">AI Engine</p>
          <p className="text-[11px] text-slate-400">Choose where scans are processed</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {(['ollama', 'groq', 'gemini'] as const).map(src => (
            <button key={src} onClick={() => setD(s => ({ ...s, source: src }))}
              className={`py-2.5 rounded-lg text-xs font-medium border transition-colors
                ${d.source === src ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
              {src === 'ollama' ? 'Ollama' : src === 'groq' ? 'Groq' : 'Gemini'}
              <span className="block text-[9px] font-normal mt-0.5 text-slate-400">
                {src === 'ollama' ? 'local · private' : 'cloud · egress'}
              </span>
            </button>
          ))}
        </div>

        {d.source === 'ollama' && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">Ollama URL</label>
              <input type="text" value={d.ollamaUrl} onChange={e => setD(s => ({ ...s, ollamaUrl: e.target.value }))}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm font-mono focus:outline-none focus:border-indigo-400 focus:bg-white transition-colors" />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 space-y-1.5 text-[11px] text-amber-800">
              <p className="font-semibold">Using Cloudflare Tunnel?</p>
              <p>Run: <code className="bg-amber-100 rounded px-1 font-mono text-[10px]">cloudflared tunnel --url http://localhost:11434</code></p>
              <p>Paste the generated URL above. Also: <code className="bg-amber-100 rounded px-1 font-mono text-[10px]">ollama pull llava</code></p>
            </div>
          </div>
        )}

        {d.source === 'groq' && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">Groq API Key</label>
              <input type="password" value={d.groqKey} onChange={e => setD(s => ({ ...s, groqKey: e.target.value }))}
                placeholder="gsk_…  (paste your Groq key)"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm font-mono focus:outline-none focus:border-indigo-400 focus:bg-white transition-colors" />
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 space-y-1 text-[11px] text-emerald-800">
              <p className="font-semibold">Free — paste a key to scan</p>
              <p>Get a free key at <span className="font-mono underline">console.groq.com</span> → API Keys</p>
              <p>Model: Llama 4 Scout 17B (vision) · runs in your browser · 14,400 req/day</p>
            </div>
          </div>
        )}

        {d.source === 'gemini' && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">Gemini API Key</label>
              <input type="password" value={d.geminiKey} onChange={e => setD(s => ({ ...s, geminiKey: e.target.value }))}
                placeholder="AIza…"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm font-mono focus:outline-none focus:border-indigo-400 focus:bg-white transition-colors" />
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 space-y-1 text-[11px] text-emerald-800">
              <p className="font-semibold">Free — no credit card needed</p>
              <p>Get key at <span className="font-mono underline">aistudio.google.com</span> → Get API key (must start with AIza)</p>
              <p>Model: Gemini 1.5 Flash · 1,500 req/day free</p>
            </div>
          </div>
        )}

        <button onClick={() => { saveAppSettings(d); onSave(d); onClose(); }}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
          Save
        </button>
      </div>
    </div>
  );
}

// ── StepBreakdown ─────────────────────────────────────────────────────────────

function StepBreakdown({ steps }: { steps: StepLog[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="px-4 pb-4 pt-2 space-y-2">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Processing Steps</p>
      {steps.map((s, i) => (
        <div key={i} className={`rounded-lg border text-xs overflow-hidden ${s.ok ? 'border-slate-200' : 'border-red-200'}`}>
          <button onClick={() => setOpen(open === i ? null : i)}
            className={`w-full flex items-center justify-between px-3 py-2 text-left font-medium transition-colors
              ${s.ok ? 'bg-slate-50 hover:bg-slate-100 text-slate-700' : 'bg-red-50 hover:bg-red-100 text-red-700'}`}>
            <span className="flex items-center gap-2">
              <span className={s.ok ? 'text-emerald-500' : 'text-red-500'}>{s.ok ? '✓' : '✗'}</span>
              {s.step}
            </span>
            <span className="flex items-center gap-2 text-[10px] text-slate-400 font-normal">
              {s.durationMs > 0 && <span>{s.durationMs.toLocaleString()}ms</span>}
              <span>{open === i ? '▲' : '▼'}</span>
            </span>
          </button>
          {open === i && (
            <div className="border-t border-slate-200 bg-white p-3 space-y-2.5">
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Input</p>
                <pre className="text-[10px] text-slate-500 whitespace-pre-wrap font-mono bg-slate-50 rounded p-2 max-h-28 overflow-y-auto">{s.input}</pre>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Output</p>
                <pre className="text-[10px] text-slate-700 whitespace-pre-wrap font-mono bg-slate-50 rounded p-2 max-h-52 overflow-y-auto">{s.output}</pre>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── FeedbackPanel ─────────────────────────────────────────────────────────────

function FeedbackPanel({ job, onSubmit }: { job: CardJob; onSubmit: (c: CardData) => void }) {
  const orig = job.originalFields ?? job.fields;
  const [draft, setDraft] = useState<CardData>({ ...job.fields });
  if (job.feedbackDone) {
    return <div className="px-4 pb-4 pt-2 text-center"><p className="text-xs text-emerald-600 font-medium">✓ Correction saved — future scans will use this as an example</p></div>;
  }
  const hasDiff = (Object.keys(draft) as (keyof CardData)[]).some(k => draft[k] !== orig[k]);
  return (
    <div className="px-4 pb-4 pt-2 space-y-3">
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Correct Extracted Fields</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Saved corrections are injected as examples into future scans.</p>
      </div>
      {CARD_FIELDS.map(({ k, label, ph, multi }) => {
        const changed = orig[k] !== draft[k];
        return (
          <div key={k} className="space-y-1">
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</label>
              {changed && orig[k] && <span className="text-[10px] text-orange-500 line-through">{orig[k]}</span>}
              {!orig[k] && <span className="text-[10px] text-slate-300">(not extracted)</span>}
            </div>
            {multi
              ? <textarea rows={2} value={draft[k]} placeholder={ph} onChange={e => setDraft(s => ({ ...s, [k]: e.target.value }))}
                  className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:bg-white transition-colors resize-y ${changed ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-slate-50 focus:border-indigo-400'}`} />
              : <input type="text" value={draft[k]} placeholder={ph} onChange={e => setDraft(s => ({ ...s, [k]: e.target.value }))}
                  className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:bg-white transition-colors ${changed ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-slate-50 focus:border-indigo-400'}`} />
            }
          </div>
        );
      })}
      <button onClick={() => onSubmit(draft)} disabled={!hasDiff}
        className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {hasDiff ? 'Submit Correction' : 'No changes — all fields correct'}
      </button>
    </div>
  );
}

// ── ViewCSVPanel ──────────────────────────────────────────────────────────────

function ViewCSVPanel({ fileName, onClose }: { fileName: string; onClose: () => void }) {
  const contacts = loadContacts().filter(c => c.name || c.role || c.company || c.email || c.phone);
  const rows = contacts.map(c => {
    const [email1, email2] = splitPair(c.email);
    const [phone1, phone2] = splitPair(c.phone);
    return { ...c, email1, email2, phone1, phone2 };
  });
  const cols: Array<{ label: string; key: keyof typeof rows[0] }> = [
    { label: 'Name',       key: 'name' },
    { label: 'Role',       key: 'role' },
    { label: 'Company',    key: 'company' },
    { label: 'Email 1',   key: 'email1' },
    { label: 'Email 2',   key: 'email2' },
    { label: 'Phone 1',   key: 'phone1' },
    { label: 'Phone 2',   key: 'phone2' },
    { label: 'Address',    key: 'address' },
    { label: 'Website',    key: 'website' },
    { label: 'Additional', key: 'additional' },
    { label: 'Added',      key: 'dateAdded' },
  ];
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl my-4 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
          <div>
            <p className="text-sm font-semibold text-slate-700">{fileName}.csv</p>
            <p className="text-[11px] text-slate-400">{rows.length} contact{rows.length !== 1 ? 's' : ''} · 2 email &amp; 2 phone columns · duplicates merged</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadCSV(fileName)} disabled={rows.length === 0}
              className="text-xs font-medium text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-40">
              Download
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">No contacts saved yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {cols.map(c => (
                    <th key={c.label} className="px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    {cols.map(c => (
                      <td key={c.label}
                        className={`px-3 py-2.5 whitespace-nowrap max-w-[180px] truncate
                          ${c.key === 'name' ? 'font-medium text-slate-800' : 'text-slate-600'}
                          ${(c.key === 'email2' || c.key === 'phone2') ? 'text-slate-400' : ''}`}>
                        {String(r[c.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CardScanner() {
  const [settings, setSettings]         = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [fileName, setFileName]         = useState('contacts');
  const [editingName, setEditingName]   = useState(false);
  const [webcamOn, setWebcamOn]         = useState(false);
  const [autoScan, setAutoScan]         = useState(true);
  const [scanPhase, setScanPhase]       = useState<ScanPhase>('searching');
  const [lockProgress, setLockProgress] = useState(0);
  const [jobs, setJobs]                 = useState<CardJob[]>([]);
  const [count, setCount]               = useState(0);
  const [fbCount, setFbCount]           = useState(0);
  const [toast, setToast]               = useState<{ msg: string; err?: boolean } | null>(null);
  const [showCSV, setShowCSV]           = useState(false);
  const [bridgeCount, setBridgeCount]   = useState(0);

  const fileNameInputRef = useRef<HTMLInputElement>(null);
  const videoRef         = useRef<HTMLVideoElement>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const processingRef    = useRef(false);
  const settingsRef      = useRef<AppSettings>(DEFAULT_SETTINGS);
  const webcamOnRef      = useRef(false);
  const autoScanRef      = useRef(true);
  const stableFramesRef  = useRef(0);
  const prevGrayRef      = useRef<Uint8Array | null>(null);
  const motionCvs        = useRef<HTMLCanvasElement | null>(null);
  const cooldownRef      = useRef(false);

  useEffect(() => {
    const s = loadAppSettings();
    setSettings(s); settingsRef.current = s;
    setCount(contactCount());
    setFbCount(feedbackCount());
    setBridgeCount(outboxCount());
    const saved = typeof window !== 'undefined' ? localStorage.getItem(FILE_KEY) : null;
    if (saved) setFileName(saved);
  }, []);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { autoScanRef.current = autoScan; }, [autoScan]);
  useEffect(() => {
    webcamOnRef.current = webcamOn;
    if (!webcamOn) { stableFramesRef.current = 0; prevGrayRef.current = null; cooldownRef.current = false; }
  }, [webcamOn]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()); }, []);

  // Focus filename input when editing starts
  useEffect(() => {
    if (editingName) fileNameInputRef.current?.select();
  }, [editingName]);

  // Queue runner
  useEffect(() => {
    if (processingRef.current) return;
    const next = jobs.find(j => j.status === 'queued');
    if (!next) return;
    processingRef.current = true;
    processJob(next.id).finally(() => { processingRef.current = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  // ── Auto-scan: frame stability detection ────────────────────────────────────

  useEffect(() => {
    if (!webcamOn) return;
    stableFramesRef.current = 0;
    prevGrayRef.current = null;
    setScanPhase('searching');
    setLockProgress(0);

    const STABLE_TARGET = 6;
    const THRESH = 9;

    function measureMotion(video: HTMLVideoElement): number {
      if (!motionCvs.current) motionCvs.current = document.createElement('canvas');
      const c = motionCvs.current;
      const W = 80, H = 45;
      c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(video, 0, 0, W, H);
      const rgba = ctx.getImageData(0, 0, W, H).data;
      const gray = new Uint8Array(W * H);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
        gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
      }
      if (!prevGrayRef.current) { prevGrayRef.current = gray; return 0; }
      let diff = 0;
      for (let i = 0; i < gray.length; i++) diff += Math.abs(gray[i] - prevGrayRef.current[i]);
      prevGrayRef.current = gray;
      return diff / gray.length;
    }

    const timer = setInterval(() => {
      const v = videoRef.current;
      if (!v || !webcamOnRef.current || !autoScanRef.current || !v.videoWidth) return;
      if (cooldownRef.current) { setScanPhase('cooldown'); return; }

      const motion = measureMotion(v);

      if (motion > THRESH) {
        stableFramesRef.current = Math.max(0, stableFramesRef.current - 2);
      } else {
        stableFramesRef.current = Math.min(stableFramesRef.current + 1, STABLE_TARGET);
      }

      const progress = (stableFramesRef.current / STABLE_TARGET) * 100;
      setLockProgress(progress);

      if (stableFramesRef.current >= STABLE_TARGET) {
        stableFramesRef.current = 0;
        prevGrayRef.current = null;
        cooldownRef.current = true;
        setScanPhase('captured');
        setLockProgress(0);

        const c2 = document.createElement('canvas');
        c2.width = v.videoWidth; c2.height = v.videoHeight;
        c2.getContext('2d')!.drawImage(v, 0, 0);
        c2.toBlob(blob => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          setJobs(prev => [...prev, { id: crypto.randomUUID(), imageUrl: url, status: 'queued', fields: { ...EMPTY } }]);
        }, 'image/jpeg', 0.95);

        setTimeout(() => {
          cooldownRef.current = false;
          setScanPhase('searching');
          setLockProgress(0);
        }, 5000);
      } else {
        setScanPhase(stableFramesRef.current > 0 ? 'locking' : 'searching');
      }
    }, 450);

    return () => { clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webcamOn]);

  function upd(id: string, patch: Partial<CardJob>) {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j));
  }

  // ── Scan ─────────────────────────────────────────────────────────────────────

  async function processJob(id: string) {
    const s = settingsRef.current;
    upd(id, { status: 'processing', source: s.source });
    const snap = jobs.find(j => j.id === id);
    if (!snap) return;
    try {
      const { base64, mediaType } = await compressForAPI(snap.imageUrl);
      const feedbackExamples = loadFeedback();
      const data = await scanCard({
        image: base64, mediaType, feedbackExamples,
        source: s.source,
        ollamaUrl: s.ollamaUrl,
        apiKey: s.source === 'groq' ? s.groqKey || undefined : s.source === 'gemini' ? s.geminiKey : undefined,
      });
      if (data.error) { upd(id, { status: 'error', error: data.error, steps: data.steps }); return; }

      const raw: CardData = { name: data.name ?? '', role: data.role ?? '', company: data.company ?? '', email: data.email ?? '', phone: data.phone ?? '', address: data.address ?? '', website: data.website ?? '', additional: data.additional ?? '' };

      // No card in frame — stop camera to avoid capture spam
      if (!raw.name && !raw.role && !raw.company && !raw.email && !raw.phone && webcamOnRef.current) {
        setJobs(prev => prev.filter(j => j.id !== id));
        stopWebcam();
        showToast('No card detected — camera stopped', true);
        return;
      }

      const enriched = enrichWithEmail(raw);
      const enrichStep: StepLog = {
        step: 'Email Enrichment', durationMs: 0, ok: true,
        input: `Email: ${raw.email || '(none)'}`,
        output: [
          enriched.insight.nameConfirmed    ? 'Name confirmed by email local-part'                      : '',
          enriched.insight.nameFromEmail    ? `Name inferred: "${enriched.insight.nameFromEmail}"`       : '',
          enriched.insight.companyConfirmed ? 'Company confirmed by email domain'                       : '',
          enriched.insight.companyFromEmail ? `Company inferred: "${enriched.insight.companyFromEmail}"` : '',
        ].filter(Boolean).join('\n') || 'No enrichment applied',
      };
      upd(id, {
        status: 'review', model: data._model,
        steps: [...(data.steps ?? []), enrichStep],
        originalFields: { ...raw },
        fields: { name: enriched.name, role: enriched.role, company: enriched.company, email: enriched.email, phone: enriched.phone, address: enriched.address, website: enriched.website, additional: enriched.additional },
        insight: enriched.insight, editing: true,
      });
    } catch (err) {
      upd(id, { status: 'error', error: err instanceof Error ? err.message : 'Scan failed' });
    }
  }

  // ── File upload (bulk) ────────────────────────────────────────────────────────

  function handleFiles(files: FileList | File[]) {
    Array.from(files).filter(f => f.type.startsWith('image/')).forEach(f =>
      setJobs(prev => [...prev, { id: crypto.randomUUID(), imageUrl: URL.createObjectURL(f), status: 'queued', fields: { ...EMPTY } }])
    );
  }

  // ── Webcam ────────────────────────────────────────────────────────────────────

  async function startWebcam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() as Record<string, unknown> | undefined;
      if (Array.isArray(caps?.focusMode) && (caps!.focusMode as string[]).includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
      }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setWebcamOn(true);
    } catch { showToast('Camera access denied or unavailable', true); }
  }

  function stopWebcam() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setWebcamOn(false);
  }

  function captureManual() {
    const v = videoRef.current;
    if (!v || !webcamOn || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob(b => {
      if (!b) return;
      setJobs(prev => [...prev, { id: crypto.randomUUID(), imageUrl: URL.createObjectURL(b), status: 'queued', fields: { ...EMPTY } }]);
    }, 'image/jpeg', 0.95);
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  function handleSave(id: string) {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    setCount(saveContact(job.fields));
    upd(id, { status: 'saved', editing: false });
    showToast('Saved to contacts');
  }
  function handleSaveAll() {
    const ready = jobs.filter(j => j.status === 'review');
    let n = 0; ready.forEach(j => { n = saveContact(j.fields); });
    if (n) { setCount(n); showToast(`Saved ${ready.length} contact${ready.length > 1 ? 's' : ''}`); }
    setJobs(prev => prev.map(j => j.status === 'review' ? { ...j, status: 'saved', editing: false } : j));
  }
  function fieldChange(id: string, key: keyof CardData, val: string) {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, fields: { ...j.fields, [key]: val } } : j));
  }

  // ── Add to Bridge (gated intake — capture ≠ commit) ────────────────────────────

  function sinkMsg(sink: string, n: number) {
    const what = n === 1 ? 'card' : `${n} cards`;
    return sink === 'outbox'
      ? `${what} added to Bridge — pending review under Tools`
      : `${what} sent to Bridge (${sink}) — pending review`;
  }

  async function handleAddToBridge(id: string) {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const env = mapCardToCapture(job.fields, { id: job.id, model: job.model, source: job.source, runMode: 'standalone' });
    const res = await addToBridge(env);
    setBridgeCount(outboxCount());
    if (res.ok) showToast(sinkMsg(res.sink, 1));
    else showToast(`Add to Bridge failed: ${res.error ?? res.sink}`, true);
  }

  async function addManyToBridge(cards: Array<{ id?: string; fields: CardData; model?: string; source?: string }>) {
    let ok = 0; let sink = 'outbox';
    for (const c of cards) {
      const res = await addToBridge(mapCardToCapture(c.fields, { id: c.id, model: c.model, source: c.source, runMode: 'standalone' }));
      if (res.ok) { ok++; sink = res.sink; }
    }
    setBridgeCount(outboxCount());
    if (ok) showToast(sinkMsg(sink, ok)); else showToast('Nothing to add to Bridge', true);
  }

  function handleAddAllReviewToBridge() {
    addManyToBridge(jobs.filter(j => j.status === 'review').map(j => ({ id: j.id, fields: j.fields, model: j.model, source: j.source })));
  }

  function handleAddSavedToBridge() {
    const contacts = loadContacts().filter(c => c.name || c.role || c.company || c.email || c.phone);
    addManyToBridge(contacts.map(c => ({ fields: c })));
  }

  // ── Feedback ──────────────────────────────────────────────────────────────────

  function handleFeedbackSubmit(id: string, corrected: CardData) {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const orig = job.originalFields ?? job.fields;
    const hasDiff = (Object.keys(corrected) as (keyof CardData)[]).some(k => corrected[k] !== orig[k]);
    if (hasDiff) { saveFeedback({ original: orig, corrected, model: job.model ?? 'unknown' }); setFbCount(feedbackCount()); showToast('Correction saved'); }
    else showToast('All fields confirmed correct');
    upd(id, { feedbackDone: true });
  }

  function showToast(msg: string, err = false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3200);
  }

  function commitFileName(val: string) {
    const clean = val.trim() || 'contacts';
    setFileName(clean);
    localStorage.setItem(FILE_KEY, clean);
    setEditingName(false);
  }

  const reviewCount = jobs.filter(j => j.status === 'review').length;
  const busyCount   = jobs.filter(j => ['queued', 'processing'].includes(j.status)).length;
  const sourceReady = settings.source === 'gemini' ? Boolean(settings.geminiKey) : true;

  const phaseStyle = {
    searching: 'border-white/40',
    locking:   'border-yellow-400',
    captured:  'border-green-400',
    cooldown:  'border-indigo-400',
  }[scanPhase];

  const phaseText = {
    searching: 'Align card in frame',
    locking:   'Hold still…',
    captured:  '✓ Got it!',
    cooldown:  'Processing…',
  }[scanPhase];

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <header className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-md">

        {/* Left: editable filename */}
        <div className="flex items-center gap-1.5 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-1">
              <input
                ref={fileNameInputRef}
                type="text"
                defaultValue={fileName}
                onBlur={e => commitFileName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitFileName((e.target as HTMLInputElement).value); if (e.key === 'Escape') setEditingName(false); }}
                className="bg-slate-700 text-white text-sm font-semibold rounded-lg px-2 py-0.5 w-36 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <span className="text-slate-400 text-sm">.csv</span>
            </div>
          ) : (
            <button onClick={() => setEditingName(true)}
              className="flex items-center gap-1.5 group text-left min-w-0">
              <span className="text-sm font-semibold text-white truncate">{fileName}</span>
              <span className="text-slate-400 text-sm">.csv</span>
              <span className="text-slate-500 group-hover:text-slate-300 text-[11px] transition-colors">✏</span>
            </button>
          )}
        </div>

        {/* Right: badges + actions + settings */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {fbCount > 0 && (
            <span className="text-xs bg-violet-600 px-2.5 py-1 rounded-full font-medium">{fbCount} correction{fbCount !== 1 ? 's' : ''}</span>
          )}
          <span className="text-xs bg-indigo-600 px-2.5 py-1 rounded-full font-medium">{count} contact{count !== 1 ? 's' : ''}</span>
          <button onClick={() => setShowCSV(true)} disabled={count === 0}
            className="text-xs border border-white/30 px-2.5 py-1 rounded-full hover:bg-white/10 transition-colors disabled:opacity-30">
            View
          </button>
          <button onClick={() => downloadCSV(fileName)} disabled={count === 0}
            className="text-xs border border-white/30 px-2.5 py-1 rounded-full hover:bg-white/10 transition-colors disabled:opacity-30">
            Download
          </button>
          <button onClick={() => setShowSettings(s => !s)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors
              ${sourceReady ? 'border-white/30 text-white/70 hover:bg-white/10' : 'border-amber-400/60 text-amber-300 hover:bg-white/10 animate-pulse'}`}>
            ⚙{!sourceReady && ' Setup'}
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">

        {showSettings && (
          <SettingsPanel init={settings} onSave={s => { setSettings(s); settingsRef.current = s; }} onClose={() => setShowSettings(false)} />
        )}

        {!sourceReady && !showSettings && (
          <section className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-amber-800">API key required for {SOURCE_LABELS[settings.source]}</p>
              <p className="text-[11px] text-amber-600 mt-0.5">Add your key in settings to start scanning</p>
            </div>
            <button onClick={() => setShowSettings(true)} className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors flex-shrink-0">Configure</button>
          </section>
        )}

        {/* Camera */}
        <section className="bg-white rounded-2xl shadow-sm overflow-hidden">

          {/* Video frame */}
          <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

            {!webcamOn && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
                <span className="text-4xl opacity-40">📷</span>
                <p className="text-sm text-white/40">Camera not started</p>
              </div>
            )}

            {webcamOn && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {/* Card frame */}
                <div className={`border-2 rounded-xl transition-colors duration-300 ${phaseStyle}`}
                  style={{ width: '82%', aspectRatio: '1.75' }}>
                  <div className="absolute -top-px -left-px w-4 h-4 border-t-2 border-l-2 rounded-tl-lg border-inherit" />
                  <div className="absolute -top-px -right-px w-4 h-4 border-t-2 border-r-2 rounded-tr-lg border-inherit" />
                  <div className="absolute -bottom-px -left-px w-4 h-4 border-b-2 border-l-2 rounded-bl-lg border-inherit" />
                  <div className="absolute -bottom-px -right-px w-4 h-4 border-b-2 border-r-2 rounded-br-lg border-inherit" />
                </div>
                {/* Phase label */}
                <div className="mt-3">
                  <span className={`text-xs font-medium px-3 py-1 rounded-full backdrop-blur-sm
                    ${scanPhase === 'captured' ? 'bg-green-500/80 text-white'   :
                      scanPhase === 'locking'  ? 'bg-yellow-500/80 text-black'  :
                      scanPhase === 'cooldown' ? 'bg-indigo-500/80 text-white'  :
                      'bg-black/40 text-white/70'}`}>
                    {autoScan ? phaseText : 'Manual mode'}
                  </span>
                </div>
                {/* Stability bar */}
                {autoScan && scanPhase === 'locking' && (
                  <div className="absolute bottom-3 left-8 right-8 h-1 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full bg-yellow-400 rounded-full transition-all duration-200" style={{ width: `${lockProgress}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              {!webcamOn ? (
                <button onClick={startWebcam}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors">
                  Start Camera
                </button>
              ) : (
                <>
                  <button onClick={captureManual}
                    className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium transition-colors">
                    Capture now
                  </button>
                  <button onClick={stopWebcam}
                    className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors">
                    Stop
                  </button>
                </>
              )}

              {/* Bulk upload */}
              <label className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5">
                <span>📁</span> Upload
                <input type="file" accept="image/*" multiple className="sr-only"
                  onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }} />
              </label>
            </div>

            {/* Auto-scan toggle */}
            {webcamOn && (
              <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-2.5">
                <div>
                  <p className="text-xs font-medium text-slate-700">Auto-scan</p>
                  <p className="text-[10px] text-slate-400">Captures when card is held still for ~2s</p>
                </div>
                <button onClick={() => setAutoScan(s => !s)}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${autoScan ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${autoScan ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Queue */}
        {jobs.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <p className="text-sm font-semibold text-slate-700">
                Queue
                {busyCount > 0 && <span className="ml-2 text-xs font-normal text-slate-400">{busyCount} scanning…</span>}
              </p>
              <div className="flex gap-2">
                {reviewCount > 1 && (
                  <button onClick={handleSaveAll} className="text-xs font-medium text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors">
                    Save all ({reviewCount})
                  </button>
                )}
                {reviewCount > 0 && (
                  <button onClick={handleAddAllReviewToBridge} className="text-xs font-medium text-slate-700 border border-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                    Add all to Bridge
                  </button>
                )}
                <button onClick={() => setJobs([])} className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors">
                  Clear all
                </button>
              </div>
            </div>

            {jobs.map(job => (
              <div key={job.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={job.imageUrl} alt="" className="w-16 h-12 object-cover rounded-lg flex-shrink-0 border border-slate-100" />
                  <div className="flex-1 min-w-0">
                    {job.status === 'queued' && <p className="text-xs text-slate-400">Waiting in queue…</p>}
                    {job.status === 'processing' && (
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-200 border-t-indigo-500 animate-spin flex-shrink-0" />
                        <p className="text-xs text-slate-600">Scanning with {SOURCE_LABELS[job.source as AISource] ?? 'AI'}…</p>
                      </div>
                    )}
                    {(job.status === 'review' || job.status === 'saved') && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium text-slate-800 truncate">{job.fields.name || job.fields.company || 'Unnamed card'}</p>
                        {job.model && <span className="text-[10px] bg-violet-100 text-violet-700 font-medium px-1.5 py-0.5 rounded">{job.model}</span>}
                        {job.insight?.nameConfirmed    && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">✓ name</span>}
                        {job.insight?.companyConfirmed && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">✓ company</span>}
                        {job.status === 'saved' && <span className="text-[10px] font-medium text-emerald-600">✓ Saved</span>}
                        {job.feedbackDone      && <span className="text-[10px] font-medium text-violet-600">✓ Feedback sent</span>}
                      </div>
                    )}
                    {job.status === 'error' && (
                      <div>
                        <p className="text-xs text-red-500 font-medium">{job.error}</p>
                        {job.steps && <p className="text-[10px] text-slate-400 mt-0.5">Click Steps for details</p>}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
                    {((job.status === 'review' || job.status === 'saved' || job.status === 'error') && job.steps) && (
                      <button onClick={() => upd(job.id, { showBreakdown: !job.showBreakdown, showFeedback: false })}
                        className="text-[10px] text-slate-500 px-2 py-1 rounded-lg hover:bg-slate-100 border border-slate-200 transition-colors">
                        {job.showBreakdown ? 'Hide steps' : 'Steps'}
                      </button>
                    )}
                    {(job.status === 'review' || job.status === 'saved') && (
                      <button onClick={() => upd(job.id, { showFeedback: !job.showFeedback, showBreakdown: false })}
                        className="text-[10px] text-violet-600 px-2 py-1 rounded-lg hover:bg-violet-50 border border-violet-200 transition-colors">
                        {job.showFeedback ? 'Close' : 'Feedback'}
                      </button>
                    )}
                    {job.status === 'review' && (
                      <button onClick={() => upd(job.id, { editing: !job.editing, showBreakdown: false, showFeedback: false })}
                        className="text-xs text-indigo-600 px-2.5 py-1 rounded-lg hover:bg-indigo-50 border border-indigo-200 transition-colors">
                        {job.editing ? 'Collapse' : 'Edit'}
                      </button>
                    )}
                    <button onClick={() => setJobs(prev => prev.filter(j => j.id !== job.id))}
                      className="text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded-lg transition-colors">✕</button>
                  </div>
                </div>

                {/* Edit form */}
                {job.editing && job.status === 'review' && (
                  <div className="px-4 pb-4 border-t border-slate-50 pt-3 space-y-3">
                    {job.insight && Object.values(job.insight).some(Boolean) && (
                      <div className="flex flex-wrap gap-1.5">
                        {job.insight.nameConfirmed    && <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">✓ Name confirmed by email</span>}
                        {job.insight.nameFromEmail    && <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">↑ Name inferred from email</span>}
                        {job.insight.companyConfirmed && <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">✓ Company confirmed by domain</span>}
                        {job.insight.companyFromEmail && <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">↑ Company inferred from domain</span>}
                      </div>
                    )}
                    {CARD_FIELDS.map(({ k, label, ph, multi }) => {
                      const ins = k === 'name' ? (job.insight?.nameConfirmed ? '✓' : job.insight?.nameFromEmail ? '↑' : undefined)
                                : k === 'company' ? (job.insight?.companyConfirmed ? '✓' : job.insight?.companyFromEmail ? '↑' : undefined) : undefined;
                      return (
                        <div key={k} className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</label>
                            {ins === '✓' && <span className="text-[10px] text-emerald-600 font-semibold">✓ email match</span>}
                            {ins === '↑' && <span className="text-[10px] text-blue-500 font-semibold">↑ from email</span>}
                          </div>
                          {multi
                            ? <textarea rows={2} value={job.fields[k]} placeholder={ph} onChange={e => fieldChange(job.id, k, e.target.value)}
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:border-indigo-400 focus:bg-white transition-colors resize-y" />
                            : <input type="text" value={job.fields[k]} placeholder={ph} onChange={e => fieldChange(job.id, k, e.target.value)}
                                className={`px-3 py-2 rounded-lg border text-sm focus:outline-none focus:bg-white transition-colors
                                  ${ins === '✓' ? 'border-emerald-300 bg-emerald-50/40 focus:border-emerald-400'
                                    : ins === '↑' ? 'border-blue-200 bg-blue-50/40 focus:border-blue-400'
                                    : 'border-slate-200 bg-slate-50 focus:border-indigo-400'}`} />
                          }
                        </div>
                      );
                    })}
                    <div className="flex gap-2">
                      <button onClick={() => handleSave(job.id)} className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors">
                        Save to contacts
                      </button>
                      <button onClick={() => handleAddToBridge(job.id)} title="Send to Bridge as a pending capture (review before it enters the graph)"
                        className="py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-black text-white text-sm font-semibold transition-colors whitespace-nowrap">
                        Add to Bridge
                      </button>
                    </div>
                  </div>
                )}

                {job.showBreakdown && job.steps && <div className="border-t border-slate-100"><StepBreakdown steps={job.steps} /></div>}
                {job.showFeedback  && <div className="border-t border-slate-100"><FeedbackPanel key={job.id} job={job} onSubmit={c => handleFeedbackSubmit(job.id, c)} /></div>}
              </div>
            ))}
          </section>
        )}

        {/* Footer */}
        <section className="bg-white rounded-2xl shadow-sm px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-700">{fileName}.csv</p>
            <p className="text-xs text-slate-400">
              {count} contact{count !== 1 ? 's' : ''} · download or add to Bridge
              {bridgeCount > 0 && <span className="text-slate-500"> · {bridgeCount} sent to Bridge</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCSV(true)} disabled={count === 0}
              className="text-sm font-medium text-slate-600 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              View
            </button>
            <button onClick={() => downloadCSV(fileName)} disabled={count === 0}
              className="text-sm font-medium text-indigo-600 border border-indigo-200 px-4 py-2 rounded-xl hover:bg-indigo-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              Download
            </button>
            <button onClick={handleAddSavedToBridge} disabled={count === 0}
              className="text-sm font-semibold text-white bg-slate-900 hover:bg-black px-4 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              Add to Bridge
            </button>
          </div>
        </section>

      </main>

      {showCSV && <ViewCSVPanel fileName={fileName} onClose={() => setShowCSV(false)} />}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm text-white shadow-lg z-50 ${toast.err ? 'bg-red-600' : 'bg-slate-900'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
