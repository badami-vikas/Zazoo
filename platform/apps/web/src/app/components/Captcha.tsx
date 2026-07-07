import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// Lightweight human-check for public forms (P3). A real deployment would use Turnstile/hCaptcha;
// this is a deterministic-enough arithmetic challenge that gates submit.
function gen() {
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 1 + Math.floor(Math.random() * 8);
  return { a, b, ans: a + b };
}

export function Captcha({ onSolved }: { onSolved: (ok: boolean) => void }) {
  const [q, setQ] = useState(gen);
  const [val, setVal] = useState('');
  useEffect(() => { onSolved(parseInt(val, 10) === q.ans); }, [val, q, onSolved]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium px-2 py-1 rounded select-none" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-navy)' }}>
        {q.a} + {q.b} = ?
      </span>
      <input value={val} onChange={e => setVal(e.target.value.replace(/[^0-9]/g, ''))} placeholder="answer" inputMode="numeric"
        className="w-20 text-sm rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy)' }} />
      <button type="button" onClick={() => { setQ(gen()); setVal(''); }} title="New challenge" className="p-1.5 rounded-lg hover:bg-[var(--color-surface)]">
        <RefreshCw className="w-3.5 h-3.5" style={{ color: 'var(--color-warm-gray)' }} />
      </button>
      {parseInt(val, 10) === q.ans && <span className="text-[11px]" style={{ color: 'var(--success)' }}>✓ verified</span>}
    </div>
  );
}
