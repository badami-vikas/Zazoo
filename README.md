# Bridge

Bridge is **Living Software**: one governed Engine adapts installed Modules around user work
across web, desktop, and mobile. See [`CLAUDE.md`](CLAUDE.md) for the full project canon
(architecture, governance rules, vocabulary) and [`docs/INDEX.md`](docs/INDEX.md) for deeper
navigation — this file only covers getting the code running locally.

## Prerequisites (macOS)

- **Node.js** — version pinned in [`.nvmrc`](.nvmrc) (currently 24). With `nvm`: `nvm use`.
- **pnpm 10.33.3** — pinned in `platform/package.json`'s `packageManager` field. Easiest via
  Corepack: `corepack enable && corepack prepare pnpm@10.33.3 --activate`.
- **Rust** (stable) — via [rustup](https://rustup.rs).
- **Xcode Command Line Tools** — `xcode-select --install`. Required for the desktop app's
  native macOS bindings (`objc2`, `tauri-nspanel`).

Linux and Windows can compile-check the desktop shell (`cargo check`), but the native
companion/overlay code is macOS-only.

## Setup

```bash
git clone https://github.com/manishsbhoopalam8498/relationship-os.git
cd relationship-os/platform
pnpm install
```

## Running the desktop app

```bash
cd apps/desktop
pnpm dev
```

This builds the API and web workspaces, starts the Vite dev server, and launches the real
native Tauri window with hot-reload on frontend changes.

To build a standalone `.app` you can launch without a terminal:

```bash
pnpm build:tauri
```

This produces an **ad-hoc-signed** build (no Apple Developer ID required) under
`src-tauri/target/release/bundle/macos/`. Ad-hoc signing is sufficient here because you're
building and running it on the same machine — macOS Gatekeeper's stricter notarization
requirement only applies to apps downloaded from elsewhere (the quarantine attribute), not to
something you compiled yourself. It is **not** suitable for handing the built `.app` to someone
else — they'd need to build it themselves the same way, or a properly notarized release (see
`.github/workflows/ci.yml`'s `desktop-bundle` job, which needs Apple signing secrets configured
in the repo).

## Running just the web frontend

```bash
cd apps/web
pnpm dev
```

Opens on `http://127.0.0.1:5173`. This is the same code the desktop shell loads, minus
native-only features (voice capture, screen pointing) — those degrade honestly rather than
faking functionality outside the Tauri shell.

## First run

- No local model is downloaded yet — the chat panel prompts to set one up, or you can switch to
  a Cloud provider (Groq) if you've added an API key in Settings.
- Without `SUPABASE_JWT_SECRET` / `SUPABASE_URL` set, the API runs with no auth verifier
  configured — reads work, but mutations (saving preferences, sending chat messages, creating
  Tasks) are rejected with 401 (fail-closed by design). Set one of those env vars to enable
  auth for a full local walkthrough.

## Verifying changes

```bash
cd platform
pnpm verify          # the one gate: typecheck + test + build, same as CI
```

```bash
cd apps/desktop
pnpm check            # cargo check
pnpm test:rust        # cargo test
```
