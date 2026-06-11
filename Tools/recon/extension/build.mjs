// esbuild script — compiles TS → dist/ (the loadable extension directory)
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, 'dist');
const watch = process.argv.includes('--watch');

mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/icons`, { recursive: true });

// Copy static assets
cpSync(resolve(__dir, 'manifest.json'), `${OUT}/manifest.json`);
cpSync(resolve(__dir, 'src/popup.html'), `${OUT}/popup.html`);

// Copy icons if they exist
for (const size of [16, 48, 128]) {
  const src = resolve(__dir, `icons/icon${size}.png`);
  if (existsSync(src)) copyFileSync(src, `${OUT}/icons/icon${size}.png`);
}

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  format: 'esm',
  logLevel: 'info',
};

const entries = [
  { in: 'src/content.ts',    out: 'content'    },
  { in: 'src/popup.ts',      out: 'popup'      },
  { in: 'src/background.ts', out: 'background' },
];

if (watch) {
  const ctx = await context({
    ...shared,
    entryPoints: entries.map((e) => ({ in: resolve(__dir, e.in), out: e.out })),
    outdir: OUT,
  });
  await ctx.watch();
  console.log('[Bridge Recon] Watching for changes…');
} else {
  await build({
    ...shared,
    entryPoints: entries.map((e) => ({ in: resolve(__dir, e.in), out: e.out })),
    outdir: OUT,
  });
  console.log(`[Bridge Recon] Built → ${OUT}`);
}
