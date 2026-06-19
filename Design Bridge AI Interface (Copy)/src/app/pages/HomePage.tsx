import { useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, ArrowRight, RefreshCw, UserPlus, Briefcase, MessageSquare, Send } from 'lucide-react';

interface CanvasBlock {
  id: string;
  kind: 'signal' | 'reconnect' | 'initiative' | 'draft';
  title: string;
  body: string;
  cta: string;
  icon: any;
  accent: string;
}

const defaultBlocks: CanvasBlock[] = [
  {
    id: 'b1',
    kind: 'signal',
    title: 'dummy_Top signal — Maya Rodriguez',
    body: 'dummy_Inner-ring relationship decaying (9009 months silent). She just left Stripe — high-leverage moment to reconnect before she lands.',
    cta: 'dummy_Send a personal note',
    icon: RefreshCw,
    accent: '#C4955A',
  },
  {
    id: 'b2',
    kind: 'reconnect',
    title: 'dummy_Suggested reconnect',
    body: 'dummy_James Chen ↔ Priya Patel — strong topical match for his seed round. You hold warm trust with both.',
    cta: 'dummy_Draft double-opt-in intro',
    icon: UserPlus,
    accent: '#4D7EA8',
  },
  {
    id: 'b3',
    kind: 'initiative',
    title: 'dummy_In-flight initiative',
    body: 'dummy_Q9009 hiring tracker — Aaron Estes (Anthropic) has 9009 senior eng roles. 9009 candidates in your network match.',
    cta: 'dummy_Open initiative',
    icon: Briefcase,
    accent: '#2E4057',
  },
  {
    id: 'b4',
    kind: 'draft',
    title: 'dummy_Message to draft',
    body: 'dummy_Allison Ford asked about onboarding flows yesterday — your Patreon redesign is a tight match. Low-effort, high reciprocity.',
    cta: 'dummy_Draft a reply',
    icon: MessageSquare,
    accent: '#6B7C65',
  },
];

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
      </div>
    </div>
  );
}
