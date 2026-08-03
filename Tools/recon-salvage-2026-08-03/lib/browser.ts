// Optional browser / anti-bot sidecar (Phase 3).
//
// When FLARESOLVERR_URL is set, fetch a URL through FlareSolverr — a self-hosted
// service that solves Cloudflare/Akamai challenges and returns rendered HTML. When
// BROWSER_URL is set instead, POST to a Playwright render service (future driver for
// the JS-render tier: Patents results, SoS portals).
//
// Neither set → no-op: callers fall back to plain fetch and keep their graceful
// "unverified pointer" behavior. This keeps the heavy/messy dependency isolated and
// fully optional, exactly like the SearXNG sidecar.
//
// Run FlareSolverr:  docker compose -f docker-compose.flaresolverr.yml up -d
// Then set:          FLARESOLVERR_URL=http://localhost:8191

export interface SolveResult {
  ok: boolean;
  html: string;
  status: number;
  ms: number;
  via: 'flaresolverr' | 'browser' | 'none';
  error?: string;
}

export function solverConfigured(): boolean {
  return !!(process.env.FLARESOLVERR_URL || process.env.BROWSER_URL);
}

export async function fetchRendered(url: string, timeoutMs = 45000): Promise<SolveResult> {
  const t = Date.now();
  const flare = process.env.FLARESOLVERR_URL;
  if (flare) {
    try {
      const r = await fetch(`${flare.replace(/\/$/, '')}/v1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: timeoutMs }),
        signal: AbortSignal.timeout(timeoutMs + 5000),
      });
      const j = (await r.json()) as { status?: string; message?: string; solution?: { status?: number; response?: string } };
      const html = j.solution?.response ?? '';
      return { ok: j.status === 'ok' && !!html, html, status: j.solution?.status ?? 0, ms: Date.now() - t, via: 'flaresolverr', error: j.status === 'ok' ? undefined : j.message };
    } catch (e) {
      return { ok: false, html: '', status: 0, ms: Date.now() - t, via: 'flaresolverr', error: e instanceof Error ? e.message : 'flaresolverr failed' };
    }
  }
  const browser = process.env.BROWSER_URL;
  if (browser) {
    try {
      const r = await fetch(`${browser.replace(/\/$/, '')}/render?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeoutMs + 5000) });
      const html = await r.text();
      return { ok: r.ok && !!html, html, status: r.status, ms: Date.now() - t, via: 'browser' };
    } catch (e) {
      return { ok: false, html: '', status: 0, ms: Date.now() - t, via: 'browser', error: e instanceof Error ? e.message : 'browser failed' };
    }
  }
  return { ok: false, html: '', status: 0, ms: Date.now() - t, via: 'none', error: 'no solver configured' };
}
