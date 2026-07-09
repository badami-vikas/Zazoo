---
title: Cross-Platform Compatibility — Desktop (mac/Linux/Windows) + Mobile (iOS/Android)
type: raw
doc_kind: plan
status: draft
companions: []
related_wiki: clients.md
updated: 2026-07-08
tags: [desktop, mobile, tauri, cross-platform]
---

# Cross-platform compatibility plan (2026-07)

Scope: what it takes to make the **desktop shell** (Tauri v2) run on macOS + Linux +
Windows and the **mobile client** (Expo/RN) run on iOS + Android, given Bridge's
"one surface-agnostic kernel, three thin clients" model (`docs/wiki/clients.md`) plus
the **optional, desktop-only Sensor SPI** (Rust capture core, macOS-first).

Ground truth as of this branch (`claude/blissful-bun-353816`): the desktop shell is
**macOS-only in practice**, and the mobile app **does not exist on this branch at all** —
it lives on `claude/heuristic-booth-f8f5da` (commit `b0e97bf`, an Expo shell scaffold),
unmerged. Everything below cites real files.

---

## 1. Current-state matrix

Legend: ✅ works · 🟡 partial / stubbed · ❌ absent/broken · — n/a

| Platform | build | run | capture (Sensor SPI) | verified |
|----------|-------|-----|----------------------|----------|
| **macOS** | 🟡 `cargo`/`tauri` compiles; `bundle.active=false` so no installer | ✅ programmatic main + overlay windows (`lib.rs`, `overlay.rs`) | 🟡 `apps` + `clipboard` real (`providers/apps.rs`, `providers/clipboard.rs`); `screen` = honest stub | 🟡 Rust unit tests (`providers/mod.rs`) + cargo check; GUI never headless-verified (per `clients.md` gap) |
| **Linux** | ❌ won't build — Apple-only crates are **unconditional** deps (`Cargo.toml`) | ❌ | ❌ no AT-SPI provider | ❌ never built in CI |
| **Windows** | ❌ same unconditional-`objc2` blocker | ❌ | ❌ no UIAutomation provider | ❌ never built in CI |
| **iOS** | 🟡 only on `heuristic-booth` branch; `expo export` smoke defined, not run here | 🟡 Expo shell renders a placeholder screen (`App.tsx`) | ❌ speech/widget/SQLite native slivers unbuilt | ❌ |
| **Android** | 🟡 same branch/shell as iOS | 🟡 same placeholder shell | ❌ | ❌ |

CI (`.github/workflows/ci.yml`) runs **only `ubuntu-latest`, JS-only** (turbo
typecheck/test/build). It never compiles Rust, never runs `tauri build`, never touches
mobile. The desktop `package.json` build/test/typecheck scripts are all `echo` no-ops by
design, so turbo stays green without ever exercising the shell.

---

## 2. Desktop (Tauri) — findings & gaps

### 2a. What is already cross-platform-clean
- **Window creation** (`lib.rs` `create_windows`, `overlay.rs`) uses only Tauri/Tao APIs
  (`WebviewWindowBuilder`, `set_position`, `set_size`, monitor geometry) — portable.
- **API sidecar** (`api_sidecar.rs`) is std-only: `TcpListener` free-port pick, `std::process::Command`
  spawning system `node`, hand-rolled HTTP `/health` probe. No macOS assumption. Uses `127.0.0.1`
  and inherits env (the `DATABASE_URL` passthrough). Portable as written.
- **Capture-core plumbing** (`providers/mod.rs`: `RawRingBuffer`, `ObservationQueue`,
  `Observation`) is explicitly OS-free and unit-tested — compiles on any host.
- **Provider implementations** are correctly `#[cfg(target_os = "macos")]`-gated
  (`providers/apps.rs`, `providers/clipboard.rs`, and the `RunningProvider` enum arms in
  `sensor_bridge.rs`). The **graceful-degradation contract holds**: sensor commands return a
  typed `SENSOR_UNSUPPORTED_PLATFORM` error off macOS, and `lib.rs` never gates core workflows
  on capture — deny/absence of sensors ⇒ app still fully works.

### 2b. macOS-only assumptions that BREAK other platforms
1. **Unconditional Apple crates (the hard blocker).** `Cargo.toml` declares `objc2`,
   `objc2-foundation`, `objc2-app-kit` as **plain `[dependencies]`**, and `tauri` with the
   `macos-private-api` feature unconditionally. On Linux/Windows these crates have no meaningful
   build and the feature is meaningless — `cargo build --target x86_64-unknown-linux-gnu` /
   `...-pc-windows-msvc` fails to compile. Even though the *call sites* are cfg-gated, the
   *dependency table* is not. **Fix: move all `objc2*` deps under
   `[target.'cfg(target_os = "macos")'.dependencies]` and make the `macos-private-api`
   tauri feature mac-only.**
2. **`macOSPrivateApi: true`** in `tauri.conf.json` is a mac concept; harmless elsewhere but
   pair it with the feature gate above.
3. **`sensor_list` returns `Err` off macOS** rather than an empty provider list. Functionally
   safe (JS treats it as "no providers"), but the cleaner contract is
   **return `Ok(vec![])`** so non-mac desktops report "zero context providers, app fine"
   rather than an error string.
4. **Overlay transparency/always-on-top**: `overlay.rs` sets `.transparent(true).shadow(false)
   .always_on_top(true).skip_taskbar(true)`. On **Linux/Wayland** transparency + client-side
   positioning is compositor-dependent (X11 works; Wayland has no absolute window positioning —
   `set_position` is a no-op, so the bottom-right anchor math silently fails). On **Windows**
   transparency needs no private API but works differently. Needs per-platform QA + a fallback
   (in-page avatar) when the compositor won't honor an undecorated transparent always-on-top
   window.

### 2c. Packaging / signing / updater — absent for ALL platforms
`bundle.active = false`. There is **no** bundle target list, **no** updater config, **no**
signing config for any OS. Nothing is a shippable installer today, mac included.

- **macOS**: enable `bundle` with `dmg`/`app`; Developer ID signing + notarization
  (`hardenedRuntime`, entitlements for the sensor perms below).
- **Linux**: needs host libs **`webkit2gtk-4.1`** (Tauri v2), `libayatana-appindicator3`,
  `librsvg2`; bundle targets **`appimage`** + **`deb`** (add `rpm` if desired). Decide
  **X11 vs Wayland** support tier (see 2b.4).
- **Windows**: ships **WebView2** (Evergreen bootstrapper is the default embed); bundle
  targets **`nsis`** and/or **`msi`** (WiX); Authenticode code-signing cert.
- **Updater**: if auto-update is wanted, add the Tauri updater plugin + signing keypair and a
  release feed — currently unconfigured on every platform.

### 2d. Sensor SPI porting plan (macOS-first → Linux/Windows)
The SPI seam is already the right shape: providers are pluggable behind `sensor_start/stop/
drain` and each is cfg-gated. Port by **adding sibling provider modules**, no shell changes:

- **`apps` (frontmost app)** — macOS `NSWorkspace` today. Windows: `GetForegroundWindow` +
  `GetWindowThreadProcessId` (win32) via the `windows` crate. Linux: X11 `_NET_ACTIVE_WINDOW`
  (via `x11rb`) / Wayland has **no** portable active-window API (needs desktop-portal or is
  unavailable — degrade honestly).
- **`clipboard`** — macOS `NSPasteboard` changeCount poll. Windows: `OpenClipboard`/
  `GetClipboardSequenceNumber`. Linux: X11 selections / `wl-clipboard` on Wayland. A
  cross-platform crate (`arboard`) covers read; keep the changeCount-style poll design.
- **`screen` (on-demand only)** — still a stub even on mac. Windows: `BitBlt`/Graphics.Capture
  API. Linux: XShm / PipeWire screencast portal (Wayland requires the portal + user consent).
- **`accessibility` / AX-tree** (named in `clients.md`, unbuilt everywhere): macOS AX API →
  **Windows UIAutomation** (`IUIAutomation`) → **Linux AT-SPI** (D-Bus). This is the biggest
  net-new capture surface and should be spec'd as its own provider trio.

**Contract to keep:** raw payloads stay local-plane (ring buffer + `sensor_read_raw` only);
only derived `Observation`s cross the gate; every ingest emits `sensor.capture` (blink tell);
kernel runs with zero providers. All already enforced structurally — new providers inherit it.

---

## 3. Mobile (Expo/RN) — findings & gaps

### 3a. What exists (on `claude/heuristic-booth-f8f5da`, not this branch)
- `platform/apps/mobile`: **Expo ~52 / RN 0.76.5, `newArchEnabled: true`**, TS strict.
  `app.json` sets **iOS `bundleIdentifier: ai.bridge.capture`**, **Android `package:
  ai.bridge.capture`**, deep-link **`scheme: "bridge"`**, portrait, `supportsTablet: false`.
- `App.tsx` is a placeholder that handles the `bridge://capture` deep link (cold + warm start
  via `expo-linking`) and renders "shell ready" — **no capture UI yet**.
- **Monorepo Metro wiring** (`metro.config.js`): watches repo root, `nodeModulesPaths` =
  app + root, `disableHierarchicalLookup = true`. Depends on `@bridge/local` (`workspace:*`).
- Build scripts: `expo run:ios`, `expo run:android`, `bundle:smoke = expo export --platform ios`.
- Design spec (`docs/superpowers/specs/2026-06-26-mobile-quick-capture-design.md`) is thorough:
  voice-first on-device capture, encrypted SQLite local-plane store, outbox→Pipeline sync,
  governed Google Calendar write-back. Only **Plan 01 (capture/outbox core)** + **Plan 02
  (Expo shell)** shipped.

### 3b. Gaps
- **Not on the mainline branch** — first task is to land/rebase the mobile package onto the
  active line so it's built and typechecked alongside the kernel.
- **No `eas.json`** → no cloud build/submit profiles for either store.
- **No permissions declared**: iOS `Info.plist` needs `NSMicrophoneUsageDescription` +
  `NSSpeechRecognitionUsageDescription`; Android needs `RECORD_AUDIO` (+ notifications on 13+).
  Neither is in `app.json` yet.
- **No min-OS floors set**: set iOS deployment target (Expo 52 baseline ≈ iOS 15+) and Android
  `minSdkVersion`/`compileSdk` explicitly for the native slivers.
- **Native modules unbuilt**: on-device speech (iOS Speech / Android `SpeechRecognizer` + Whisper
  fallback), home-screen widget (WidgetKit / Android Glance), SQLCipher-backed SQLite local
  adapter, `LocalMediaStore` (expo-file-system) adapter, outbox/sync engine. All of these push
  the app off Expo Go onto **dev-client / prebuilt native builds**.
- **No `.npmrc`** committed. Project memory ("Mobile build env") records that Metro needs
  Node ≥ 20 and a `node-linker=hoisted` `.npmrc` for `@babel/runtime`; the current config leans
  on `disableHierarchicalLookup` instead — verify which is actually required and commit it so
  CI/other machines reproduce.
- **Push notifications / offline / deep links**: deep-link scheme wired; push (Expo Notifications
  / APNs + FCM) and the on-device offline store are designed but unbuilt.

### 3c. Responsive web-in-mobile (the `<DataViews>` claim) — CONFIRMED
The shared view grammar is genuinely 375px-safe (matters because mobile/web reuse the same
React surface): `TableView.tsx` wraps in `overflow-x-auto`; `KanbanView.tsx` becomes an
80vw swipeable column strip; `CalendarView.tsx` swaps its 7-col grid for a single-col agenda
below `sm:`; `GalleryView.tsx` is `grid-cols-1` at base; `DashboardView.tsx` is a plain block.
`ApprovalsPage.tsx` is the approval surface. So the "approval cards render at 375px" doc claim
holds for the web client; a native mobile approval queue is still its own build.

---

## 4. Cross-cutting

### 4a. Build matrix (target state)
| Job | Runner | Builds |
|-----|--------|--------|
| platform (exists) | ubuntu | JS typecheck/test/build |
| desktop-macos (new) | macos-latest | `cargo test` + `tauri build` (dmg, signed) |
| desktop-linux (new) | ubuntu (webkit2gtk-4.1 libs) | `cargo test` + `tauri build` (appimage/deb) |
| desktop-windows (new) | windows-latest | `cargo test` + `tauri build` (nsis/msi) |
| mobile (new) | ubuntu / EAS | `expo export` smoke both platforms; EAS build on release |

None of the four new jobs exist today.

### 4b. Ports-and-adapters seams (what makes per-platform capture pluggable)
- **Rust side**: `sensor_bridge.rs` command surface + `RunningProvider` enum + cfg-gated
  provider modules = the SPI. Adding a platform = adding a `#[cfg(target_os=...)]` module + enum
  arm; the drain/ring-buffer/observation plumbing (`providers/mod.rs`) is shared and OS-free.
- **TS side**: `@bridge/sensors` (`hub.ts`, `capture-ledger.ts`, `types.ts`) is the raw/derived
  type split every surface consumes; `@bridge/local` (`stores/`) is the local-plane port the
  mobile SQLite adapter and desktop pglite adapter both satisfy.
- **API residency**: `api_sidecar.rs` binds loopback only and injects `window.__BRIDGE_API_URL__`;
  the same web bundle runs in browser, desktop webview, and (future) mobile webview/RN via the
  shared tRPC client.

### 4c. DEFINED vs UNBUILT
- **Built & working (macOS only)**: Tauri shell windows, API sidecar, overlay avatar, `apps` +
  `clipboard` capture, shared responsive DataViews.
- **Defined, not built**: Linux/Windows desktop builds & installers, updater/signing (all OS),
  AX-tree/UIAutomation/AT-SPI providers, screen capture, full mobile capture app (speech, widget,
  SQLite, outbox sync, calendar write-back), EAS build pipeline, CI jobs for Rust/mobile.

---

## 5. Prioritized plan to 5-platform coverage

**P0 — unblock desktop portability (small, high-leverage)**
1. Cfg-gate the Apple crates + `macos-private-api` feature in `Cargo.toml` so
   `cargo build` succeeds on Linux/Windows. Return `Ok(vec![])` from `sensor_list` off macOS.
2. Add `desktop-linux` + `desktop-windows` `cargo check`/`test` CI jobs to lock portability in.

**P1 — desktop runnable + shippable on 3 OSes**
3. Enable `bundle` with per-OS targets (dmg / appimage+deb / nsis+msi); document Linux host libs
   (`webkit2gtk-4.1`, appindicator, rsvg); WebView2 embed for Windows.
4. Per-platform overlay QA (X11 vs Wayland positioning, Windows transparency) with in-page
   fallback when the compositor won't honor it.
5. Code-signing + notarization (mac), Authenticode (Windows); optional updater plugin.

**P2 — capture parity beyond macOS**
6. Port `apps` + `clipboard` to Windows (win32 / `arboard`) and Linux/X11; degrade honestly on
   Wayland. Then the `accessibility` provider trio (UIAutomation / AT-SPI / AX) as net-new.

**P3 — mobile to both stores**
7. Rebase `platform/apps/mobile` onto mainline; commit `.npmrc`/Node pin; add `eas.json`.
8. Declare mic/speech permissions + min-OS floors; wire push + deep links.
9. Build the native slivers (speech, widget, SQLCipher SQLite adapter, `LocalMediaStore`, outbox
   sync) per the shipped design spec; add `expo export` smoke + EAS build CI.
</content>
</invoke>
