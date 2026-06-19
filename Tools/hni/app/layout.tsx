import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'HNI Finder — wealth & LP profiling',
  description: 'Zero-cost HNI profile from FEC, IRS 990-PF, SEC EDGAR, FINRA, OpenSanctions, CourtListener, GDELT.',
};

const css = `
  :root {
    --bg:#09090b; --panel:#111113; --panel2:#18181b; --line:#27272a;
    --fg:#f4f4f5; --muted:#71717a; --accent:#6366f1; --accent2:#818cf8;
    --good:#22c55e; --warn:#f59e0b; --bad:#ef4444; --info:#38bdf8;
    color-scheme: dark;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--fg);
    font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  a { color: var(--accent2); text-decoration: none; }
  a:hover { text-decoration: underline; }
  input, select, button, textarea { font: inherit; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 32px 20px 80px; }

  /* Nav */
  .nav { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
  .nav-logo { font-size: 18px; font-weight: 700; letter-spacing: -.01em; }
  .nav-logo span { color: var(--accent2); }
  .nav-tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #1c1c3a; color: var(--accent2); border: 1px solid #3730a3; }

  /* Search */
  .search-box { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 24px; margin-bottom: 24px; }
  .search-box h2 { font-size: 15px; font-weight: 600; margin-bottom: 16px; color: var(--fg); }
  .form-grid { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
  .form-grid.wide { grid-template-columns: 1fr; }
  .field label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 5px; text-transform: uppercase; letter-spacing: .05em; }
  .field input, .field select {
    width: 100%; padding: 9px 12px; background: var(--bg); border: 1px solid var(--line);
    border-radius: 8px; color: var(--fg); outline: none; transition: border-color .15s;
  }
  .field input:focus, .field select:focus { border-color: var(--accent); }
  .btn-row { margin-top: 16px; display: flex; gap: 10px; align-items: center; }
  .btn {
    cursor: pointer; padding: 10px 20px; border-radius: 8px; border: none;
    background: var(--accent); color: #fff; font-weight: 600; font-size: 14px;
    transition: opacity .15s;
  }
  .btn:hover { opacity: .88; }
  .btn:disabled { opacity: .4; cursor: not-allowed; }
  .btn.ghost { background: transparent; border: 1px solid var(--line); color: var(--muted); }

  /* Status */
  .status { font-size: 13px; color: var(--muted); }
  .status.running { color: var(--info); }
  .status.err { color: var(--bad); }

  /* Profile layout */
  .profile { display: grid; gap: 16px; }
  .section { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .sec-head {
    display: flex; align-items: center; gap: 8px;
    padding: 14px 18px; border-bottom: 1px solid var(--line);
    background: var(--panel2);
  }
  .sec-icon { font-size: 16px; }
  .sec-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .sec-count { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #1c1c3a; color: var(--accent2); }
  .sec-body { padding: 16px 18px; }

  /* KV rows */
  .kv-table { display: grid; grid-template-columns: 220px 1fr; gap: 0; }
  .kv-row { display: contents; }
  .kv-row > * { padding: 7px 0; border-bottom: 1px solid #1e1e22; font-size: 13px; }
  .kv-row:last-child > * { border-bottom: none; }
  .kv-k { color: var(--muted); padding-right: 12px; }
  .kv-v { color: var(--fg); }

  /* Tier badges */
  .tier { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 700;
    padding: 1px 6px; border-radius: 4px; letter-spacing: .03em; }
  .tier-A { background: #052e16; color: #4ade80; border: 1px solid #166534; }
  .tier-B { background: #1c1a0a; color: #fbbf24; border: 1px solid #92400e; }
  .tier-C { background: #1e0f0e; color: #f87171; border: 1px solid #991b1b; }

  /* Signal cards */
  .signal { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid #1e1e22; }
  .signal:last-child { border-bottom: none; }
  .signal-body { flex: 1; }
  .signal-label { font-size: 13px; font-weight: 500; }
  .signal-detail { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .signal-source { font-size: 11px; color: var(--muted); margin-top: 3px; }

  /* Table */
  .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tbl th { text-align: left; padding: 6px 10px; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--line); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .tbl td { padding: 7px 10px; border-bottom: 1px solid #1e1e22; }
  .tbl tr:last-child td { border-bottom: none; }

  /* News */
  .news-item { padding: 8px 0; border-bottom: 1px solid #1e1e22; }
  .news-item:last-child { border-bottom: none; }
  .news-date { font-size: 11px; color: var(--muted); }
  .news-title { font-size: 13px; margin-top: 1px; }

  /* Steps */
  details summary { cursor: pointer; font-size: 12px; color: var(--muted); padding: 10px 0; }
  .step { font-size: 12px; padding: 5px 0; border-bottom: 1px solid #1e1e22; display: flex; gap: 8px; align-items: baseline; }
  .step:last-child { border-bottom: none; }
  .step .ok { color: var(--good); } .step .no { color: var(--bad); }
  .step-detail { color: var(--muted); margin-left: 4px; }

  /* Compliance */
  .comp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .comp-card { background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
  .comp-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .comp-val { font-size: 18px; font-weight: 700; margin-top: 4px; }
  .comp-val.clean { color: var(--good); }
  .comp-val.hit { color: var(--bad); }
  .comp-val.unknown { color: var(--warn); }

  /* Wealth summary cards */
  .wealth-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .wealth-card { background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
  .wealth-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
  .wealth-val { font-size: 20px; font-weight: 700; margin-top: 4px; color: var(--accent2); }
  .wealth-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }

  /* Foundation history */
  .fh-bar-wrap { display: flex; align-items: flex-end; gap: 6px; height: 60px; margin-top: 10px; }
  .fh-bar { flex: 1; background: var(--accent); border-radius: 3px 3px 0 0; min-height: 4px; }
  .fh-labels { display: flex; gap: 6px; margin-top: 4px; }
  .fh-lbl { flex: 1; text-align: center; font-size: 10px; color: var(--muted); }

  /* Political chart */
  .pol-bar { height: 8px; border-radius: 4px; background: var(--line); margin-top: 6px; overflow: hidden; }
  .pol-fill-d { height: 100%; background: #3b82f6; border-radius: 4px 0 0 4px; }
  .pol-fill-r { height: 100%; background: #ef4444; border-radius: 0 4px 4px 0; }

  /* Mode tabs */
  .tab-row { display: flex; gap: 8px; margin-bottom: 20px; }
  .tab-btn {
    padding: 9px 20px; border-radius: 8px; border: 1px solid var(--line);
    background: transparent; color: var(--muted); cursor: pointer; font-size: 14px;
    transition: all .15s;
  }
  .tab-btn:hover { color: var(--fg); border-color: var(--accent); }
  .tab-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 600; }

  /* Results */
  .results-header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 16px; font-size: 14px; color: var(--fg); font-weight: 600;
  }
  .results-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
    margin-bottom: 40px;
  }
  .result-card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 16px; transition: border-color .15s;
  }
  .result-card:hover { border-color: var(--accent); }
  .result-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
  .result-name { font-size: 15px; font-weight: 700; line-height: 1.3; }
  .result-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .result-amount { font-size: 16px; font-weight: 700; color: var(--accent2); white-space: nowrap; }
  .empty-state { text-align: center; padding: 32px 0; color: var(--muted); font-size: 14px; }

  /* Responsive */
  @media (max-width: 640px) {
    .form-grid { grid-template-columns: 1fr; }
    .kv-table { grid-template-columns: 140px 1fr; }
    .comp-grid { grid-template-columns: 1fr; }
    .wealth-grid { grid-template-columns: 1fr; }
  }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body suppressHydrationWarning>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
