// The standardized "Apps" connection wizard (Phase 2): API-first, waterfall to
// scrape/bot/Claude-in-browser when no API exists — guided step-by-step, same modal for every
// app across the platform so users never learn a new connection flow per integration.
import { useEffect, useState } from 'react';
import { Sparkles, CheckCircle2, Key, Globe, Bot, MousePointerClick, ArrowRight, Loader2, X } from 'lucide-react';

type Method = 'api' | 'scrape' | 'bot' | 'claude_browser';

const METHOD_META: Record<Method, { label: string; icon: typeof Key; desc: string }> = {
  api: { label: 'Direct API', icon: Key, desc: 'Fastest and most reliable — used whenever the provider exposes one.' },
  scrape: { label: 'Structured scrape', icon: Globe, desc: 'Reads the provider\'s pages on a schedule. Good for read-only data, no login automation.' },
  bot: { label: 'Browser bot', icon: Bot, desc: 'Automates a real login + click-through for providers with no API or scrape-friendly pages.' },
  claude_browser: { label: 'Claude in browser', icon: MousePointerClick, desc: 'Claude drives an actual browser session for anything the other two can\'t reach — slowest, most flexible.' },
};

// Step-by-step AI narration for each stage of the waterfall, kept ultra-short per the platform's
// "condense, don't explain" convention (matches the Boundaries tooltip pattern).
export function ConnectAppFlow({ appName, apiAvailable, onClose, onConnected }: { appName: string; apiAvailable: boolean; onClose: () => void; onConnected: (method: Method) => void }) {
  const [step, setStep] = useState<'checking' | 'choose' | 'auth' | 'connecting' | 'done'>('checking');
  const [method, setMethod] = useState<Method | null>(null);
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setStep(apiAvailable ? 'auth' : 'choose'), 700);
    if (apiAvailable) setMethod('api');
    return () => clearTimeout(t);
  }, [apiAvailable]);

  function chooseMethod(m: Method) {
    setMethod(m);
    setStep('auth');
  }

  function connect() {
    setStep('connecting');
    setTimeout(() => {
      setStep('done');
      setTimeout(() => onConnected(method!), 900);
    }, 1100);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <Sparkles className="w-4 h-4" style={{ color: 'var(--color-steel)' }} />
          <span className="text-sm font-bold flex-1" style={{ color: 'var(--color-navy)' }}>Connect {appName}</span>
          <button onClick={onClose}><X className="w-4 h-4" style={{ color: 'var(--color-warm-gray)' }} /></button>
        </div>

        <div className="p-5 flex flex-col gap-4 min-h-[220px]">
          {step === 'checking' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-steel)' }} />
              <span className="text-sm" style={{ color: 'var(--color-navy-mid)' }}>Checking for a direct API…</span>
            </div>
          )}

          {step === 'choose' && (
            <>
              <p className="text-xs" style={{ color: 'var(--color-warm-gray)' }}>No public API found for {appName}. Pick a fallback method — recommended order below.</p>
              {(['scrape', 'bot', 'claude_browser'] as Method[]).map((m) => {
                const meta = METHOD_META[m];
                return (
                  <button key={m} onClick={() => chooseMethod(m)} className="flex items-start gap-3 p-3 rounded-xl border text-left hover:shadow-sm transition-shadow" style={{ borderColor: 'var(--color-border)' }}>
                    <meta.icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--color-steel)' }} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>{meta.label}</span>
                      <span className="block text-xs" style={{ color: 'var(--color-warm-gray)' }}>{meta.desc}</span>
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 ml-auto mt-1 shrink-0" style={{ color: 'var(--color-warm-gray)' }} />
                  </button>
                );
              })}
            </>
          )}

          {step === 'auth' && method && (
            <>
              <div className="flex items-center gap-2 text-xs font-medium px-2.5 py-1.5 rounded-lg w-fit" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 10%, white)', color: 'var(--color-steel)' }}>
                {(() => { const Icon = METHOD_META[method].icon; return <Icon className="w-3.5 h-3.5" />; })()}
                {METHOD_META[method].label}
              </div>
              {method === 'api' ? (
                <>
                  <label className="text-xs font-semibold" style={{ color: 'var(--color-navy-mid)' }}>API key</label>
                  <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="dummy_sk-..." className="px-3 py-2 rounded-lg border text-sm font-mono" style={{ borderColor: 'var(--color-border)' }} />
                </>
              ) : (
                <p className="text-xs" style={{ color: 'var(--color-navy-mid)' }}>
                  {method === 'scrape' && 'AI will confirm the page structure once, then sync on a schedule.'}
                  {method === 'bot' && 'AI will simulate a guided login now — you\'ll confirm each sensitive step.'}
                  {method === 'claude_browser' && 'A live Claude browser session opens next — you stay in control throughout.'}
                </p>
              )}
              <button onClick={connect} disabled={method === 'api' && !apiKey.trim()} className="mt-2 w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--color-steel)' }}>
                Continue
              </button>
            </>
          )}

          {step === 'connecting' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-steel)' }} />
              <span className="text-sm" style={{ color: 'var(--color-navy-mid)' }}>Connecting via {method ? METHOD_META[method].label.toLowerCase() : ''}…</span>
            </div>
          )}

          {step === 'done' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8">
              <CheckCircle2 className="w-8 h-8" style={{ color: 'var(--success)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--color-navy)' }}>Connected</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
