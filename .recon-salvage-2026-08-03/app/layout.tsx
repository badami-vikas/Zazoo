import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Recon — pre-meeting background check',
  description: 'Zero-cost, deterministic pre-meeting research across 10 free public sources.',
};

const css = `
  :root { color-scheme: light dark; --bg:#0b0d10; --panel:#14181d; --line:#262d36; --fg:#e7ecf2; --muted:#8b97a7; --accent:#5b9dff; --good:#3fb37f; --warn:#e0b341; --bad:#e0614f; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  a { color:var(--accent); }
  input, select, button { font: inherit; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 28px 20px 80px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; margin:14px 0; }
  .grid { display:grid; gap:10px; grid-template-columns: repeat(2, 1fr); }
  label { display:block; font-size:12px; color:var(--muted); margin-bottom:4px; }
  .field input, .field select { width:100%; padding:9px 11px; background:#0e1115; border:1px solid var(--line); border-radius:8px; color:var(--fg); }
  button { cursor:pointer; padding:10px 16px; border-radius:8px; border:1px solid var(--line); background:var(--accent); color:#04121f; font-weight:600; }
  button.secondary { background:transparent; color:var(--fg); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:16px; margin:18px 0 8px; } h3 { font-size:13px; color:var(--muted); margin:14px 0 6px; text-transform:uppercase; letter-spacing:.04em; }
  .cand { border:1px solid var(--line); border-radius:10px; padding:12px; margin:8px 0; cursor:pointer; display:flex; gap:10px; align-items:flex-start; }
  .cand.sel { border-color:var(--accent); background:#0e1620; }
  .tag { font-size:11px; padding:2px 7px; border-radius:999px; border:1px solid var(--line); color:var(--muted); }
  .conf { font-variant-numeric: tabular-nums; color:var(--muted); font-size:12px; }
  .kv { display:grid; grid-template-columns: 200px 1fr; gap:6px 14px; padding:6px 0; border-bottom:1px solid #1c222a; }
  .kv .k { color:var(--muted); font-size:13px; } .kv .v { font-size:14px; }
  .sig { border-left:3px solid var(--warn); padding:8px 12px; margin:8px 0; background:#171309; border-radius:0 8px 8px 0; }
  .muted { color:var(--muted); } .small { font-size:12px; }
  .step { border-bottom:1px solid #1c222a; padding:7px 0; font-size:12px; }
  .ok { color:var(--good); } .no { color:var(--bad); }
  details summary { cursor:pointer; color:var(--muted); }
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
