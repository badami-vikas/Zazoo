# Cross-Platform — desktop ×3, mobile ×2

full: [../raw/cross-platform-compatibility-2026-07.md](../raw/cross-platform-compatibility-2026-07.md) · 2026-07-08. Related: [clients](clients.md).

**Reality: 1 of 5 target platforms exercised = macOS only.** "One kernel, three thin clients"
is real in shape, not yet in coverage.

**Current state matrix** (build · run · capture · verified):
- **macOS** ✅ shell builds+runs (main + overlay windows, std-only `api_sidecar.rs`), 2 capture
  providers work (`apps`, `clipboard`), `screen` = honest stub.
- **Linux** ❌ **cannot compile** — `Cargo.toml` lists `objc2`/`objc2-app-kit`/`objc2-foundation`
  + `macos-private-api` as UNCONDITIONAL deps (call sites cfg-gated, dep table is not).
- **Windows** ❌ same block; no WebView2 notes.
- **iOS / Android** ❌ mobile client **not on active branch** — minimal Expo 52 / RN 0.76.5 shell
  stranded on `claude/heuristic-booth-f8f5da` (`b0e97bf`), placeholder screen only.
- **CI** = ubuntu-only, JS-only (`.github/workflows/ci.yml`); never compiles Rust, never
  `tauri build`, never mobile. Desktop `package.json` build/test = `echo` no-ops ⇒ "green CI"
  has NEVER validated the shell on any OS.
- ✅ confirmed positive: shared `<DataViews>` grammar + approval surface DO render at 375px.

**Biggest gaps**: (1) desktop won't build off-mac (Apple crates unconditional). (2)
`bundle.active=false` — NO installer/signing/updater for ANY OS incl mac. (3) capture beyond
macOS entirely unbuilt (no Windows UIAutomation, no Linux AT-SPI); SPI seam shaped right, AX
provider unbuilt everywhere. (4) mobile: no `eas.json`, no mic/speech perms, no min-OS floors;
on-device speech / widget / SQLCipher store / outbox sync all design-only.

**Plan (additive — graceful degradation already structural, deny/absence of sensors ⇒ app still
fully usable)**:
- **P0 cheap/high-leverage**: cfg-gate the Apple crates so `cargo build` succeeds on Lin/Win ·
  empty provider list off-mac · add `cargo check` CI jobs for all 3 desktop OSes.
- **P1**: per-OS bundles (dmg / appimage+deb / nsis+msi) · document Linux webkit2gtk-4.1 deps +
  Windows WebView2 · signing/notarization · QA transparent overlay on X11/Wayland/Windows +
  in-page fallback.
- **P2**: port `apps`/`clipboard` capture to win32 + X11 (degrade honestly on Wayland) → build
  accessibility-provider trio (macOS AX / Windows UIAutomation / Linux AT-SPI).
- **P3**: rebase mobile package to mainline · commit `.npmrc` (node-linker=hoisted) + Node≥20 pin
  · add `eas.json` + iOS plist / Android perms + min-OS floors · build native capture slivers.
