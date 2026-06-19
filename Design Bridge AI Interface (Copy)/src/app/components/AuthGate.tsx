import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

// Logged-in-only gate. No session → login screen. Canonical (global) reads ride the
// authenticated role; private/relationship data stays local to the user.
export function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState('badami@wustl.edu');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setAuthed(!!data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setAuthed(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  };

  if (!ready) {
    return <div className="h-screen w-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-warm-gray)' }}>Loading…</div>;
  }

  if (authed) return <>{children}</>;

  return (
    <div className="h-screen w-full flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shadow-md" style={{ background: 'linear-gradient(135deg, var(--color-steel), var(--color-navy-mid))' }}>
            <span className="text-white font-bold" style={{ fontFamily: 'var(--font-editorial)' }}>B</span>
          </div>
          <span className="text-xl font-bold" style={{ color: 'var(--color-navy)' }}>Bridge <span style={{ color: 'var(--color-steel)' }}>AI</span></span>
        </div>

        <div className="rounded-2xl border shadow-sm p-6" style={{ backgroundColor: 'white', borderColor: 'var(--color-border)' }}>
          <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-editorial)' }}>Sign in</h1>
          <p className="text-sm mb-5" style={{ color: 'var(--color-navy-mid)' }}>Bridge is private to your workspace. Sign in to continue.</p>

          <form onSubmit={signIn} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>Email</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-[var(--color-steel)]" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-warm-gray)' }}>Password</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus placeholder="••••••••" className="px-3 py-2.5 rounded-lg border text-sm outline-none focus:border-[var(--color-steel)]" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }} />
            </label>
            {error && <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>{error}</div>}
            <button type="submit" disabled={busy} className="mt-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-60" style={{ backgroundColor: 'var(--color-steel)' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs mt-4" style={{ color: 'var(--color-warm-gray)' }}>Demo: badami@wustl.edu</p>
      </div>
    </div>
  );
}
