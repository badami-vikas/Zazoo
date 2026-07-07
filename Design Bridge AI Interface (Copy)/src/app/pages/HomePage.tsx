import { useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, ArrowRight, RefreshCw, UserPlus, Briefcase, MessageSquare, Send, Inbox } from 'lucide-react';

interface CanvasBlock {
  id: string;
  kind: 'signal' | 'reconnect' | 'initiative' | 'draft';
  title: string;
  body: string;
  cta: string;
  icon: any;
  accent: string;
}

// No canvas blocks ship as placeholder content. Real blocks are generated from the user's own
// Signals, calendar, and active Initiatives once those sources are connected/populated — until
// then the canvas shows an honest empty state below.
const defaultBlocks: CanvasBlock[] = [];

export function HomePage() {
  const [intent, setIntent] = useState('');
  const [blocks] = useState<CanvasBlock[]>(defaultBlocks);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="@container flex-1 flex flex-col h-full overflow-auto"
      style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="max-w-4xl mx-auto w-full px-6 py-10 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-steel)' }}>
            <Sparkles className="w-3.5 h-3.5" />
            Adaptive canvas · {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <h1 style={{
            fontFamily: 'var(--font-editorial)',
            fontSize: '34px',
            fontWeight: 600,
            color: 'var(--color-navy)',
            letterSpacing: '-0.02em',
          }}>
            {greeting}. Here's what matters in the next hour.
          </h1>
          <p style={{ color: 'var(--color-warm-gray)', maxWidth: 640 }}>
            Four adaptive blocks generated from your signals, calendar, and active initiatives. Re-steer the canvas
            below.
          </p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); }}
          className="flex items-center gap-2 border rounded-xl px-3 py-2 shadow-sm bg-white"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <Sparkles className="w-4 h-4 shrink-0" style={{ color: 'var(--color-steel)' }} />
          <input
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="What should I focus on next hour? (e.g. 'prep for Config dinner', 'fundraising follow-ups')"
            className="flex-1 outline-none text-sm bg-transparent"
            style={{ color: 'var(--color-navy)' }}
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--color-steel)' }}
          >
            <Send className="w-3.5 h-3.5" />
            Re-shape
          </button>
        </form>

        {blocks.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-3 border rounded-xl bg-white py-16 px-6 text-center"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--color-steel) 12%, transparent)' }}>
              <Inbox className="w-5 h-5" style={{ color: 'var(--color-steel)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-navy)' }}>No adaptive blocks yet</p>
            <p className="text-sm max-w-sm" style={{ color: 'var(--color-warm-gray)' }}>
              Blocks appear here once Bridge has real Signals, calendar activity, or active Initiatives to draw from.
              Connect a data source or create your first Initiative to get started.
            </p>
          </div>
        ) : (
        <div className="grid grid-cols-1 @[700px]:grid-cols-2 gap-3">
          {blocks.map((b, i) => {
            const Icon = b.icon;
            return (
              <motion.article
                key={b.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border rounded-xl bg-white p-5 hover:shadow-md transition-shadow flex flex-col gap-3"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: b.accent + '15' }}>
                    <Icon className="w-5 h-5" style={{ color: b.accent }} />
                  </div>
                  <h3 style={{
                    fontFamily: 'var(--font-editorial)',
                    fontSize: '15px',
                    fontWeight: 600,
                    color: 'var(--color-navy)',
                  }}>
                    {b.title}
                  </h3>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-navy-mid)' }}>
                  {b.body}
                </p>
                <button
                  className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-steel)' }}
                >
                  {b.cta}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </motion.article>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}
