---
title: Design System (v0)
type: raw
doc_kind: reference
status: Canonical brand + typography + color tokens; formalizes theme.css, fills gaps, maps violations → target tokens
companions: [DESIGN-FIX.md, DESIGN-AUDIT.md]
related_wiki: wiki/design-system.md
updated: 2026-06-22
tags: [design-system, tokens, branding]
---

# Bridge AI — Design System (v0)

> Canonical brand + typography + color tokens. **Source of truth in code:** `Design Bridge AI Interface (Copy)/src/styles/theme.css` (the prototype already defines a good Bridge system). This doc **formalizes** it, fills gaps (status colors, type scale, a11y, agentic accent, dark mode), and maps current **violations → target tokens** so the prototype can be brought into alignment.
> Brand spine: vocabulary is the brand; **trust-first, calm, premium** (VC/GP funds). Visual mood = warm paper + editorial serif + restrained steel. NOT loud SaaS.

---

## 0. The core finding

The prototype **has** a coherent Bridge design system in `theme.css` — but components largely **ignore it**, hardcoding values instead. Alignment = make components consume the tokens, not a redesign.

```yaml
violations:
  - symptom: "Material purple #6200EE (+#5000C9/#4C00B8)"
    count_approx: "226 hits / 11 files"
    verdict: "off-brand leak — concentrated in Operational/AI screens"
  - symptom: "Material cyan/teal #00E5FF #0099CC #00897B"
    count_approx: "~75"
    verdict: "off-brand leak"
  - symptom: "Raw Tailwind grays (text-gray-*, bg-gray-50, border-gray-200)"
    count_approx: "~900"
    verdict: "cool grays clash with warm paper → map to tokens"
  - symptom: "Raw status colors (green/red/orange/yellow/blue/teal-50..700)"
    count_approx: "~250"
    verdict: "un-tokenized → define semantic status set"
  - symptom: "One-off hex near brand values (#2a2a2a, #fcfaf4, #6b7c65, #c4955a…)"
    count_approx: "~80"
    verdict: "duplicates of existing tokens"
  - symptom: "Ad-hoc font sizes text-[9px]/[10px]/[11px]/[13px] + inline fontSize"
    count_approx: "~55"
    verdict: "off-scale; 9–11px fails legibility/a11y"
  - symptom: "font-black / stray font-serif utilities"
    count_approx: "~14"
    verdict: "outside the 300–600 weight scale"
  - symptom: "Dead default_shadcn_theme.css (stock shadcn, unimported)"
    count_approx: "—"
    verdict: "delete"
  - symptom: "Dead deps @mui/material, @mui/icons-material, @emotion/* (0 imports)"
    count_approx: "—"
    verdict: "remove from package.json"
  - symptom: "Broken dark mode (.dark reverts to generic oklch + purple)"
    count_approx: "—"
    verdict: "decide: author Bridge dark or defer"
```

---

## 1. Color tokens (canonical — from `theme.css`)

**Primary palette**
```yaml
primary_palette:
  - token: "--color-background"
    hex: "#FAF9F5"
    role: "warm paper — app background"
  - token: "--color-surface"
    hex: "#F0EEE8"
    role: "cards, raised surfaces, inputs"
  - token: "--color-navy"
    hex: "#1A2B3C"
    role: "primary ink (headings, high-emphasis text)"
  - token: "--color-navy-mid"
    hex: "#2E4057"
    role: "body ink (secondary text)"
  - token: "--color-steel"
    hex: "#4D7EA8"
    role: "primary — actions, links, focus ring"
  - token: "--color-steel-light"
    hex: "#7FA5C5"
    role: "accent / hover / selected"
```

**Supporting**
```yaml
supporting:
  - token: "--color-warm-gray"
    hex: "#B8B4A8"
    role: "muted text, disabled, neutral"
  - token: "--color-border"
    hex: "#E2DED5"
    role: "hairlines, dividers"
  - token: "--color-sage"
    hex: "#6B7C65"
    role: "trust / positive-relationship"
  - token: "--color-amber-soft"
    hex: "#C4955A"
    role: "attention / dormant"
```

**Semantic relationship colors** (drive Orbit/warmth — *never shown as a naked number*, only hue/position):
```yaml
relationship_colors:
  - token: "--color-warm"
    hex: "#4D7EA8 (steel)"
    meaning: "warm / active relationship"
  - token: "--color-trust"
    hex: "#6B7C65 (sage)"
    meaning: "established trust"
  - token: "--color-dormant"
    hex: "#C4955A (amber)"
    meaning: "going cold / dormant"
  - token: "--color-neutral"
    hex: "#B8B4A8"
    meaning: "neutral / unknown"
```

**Status colors (NEW — to define; currently raw Tailwind).** Harmonize to the warm-paper palette (muted, not neon):
```yaml
status_colors:
  - token: "--color-success"
    proposed_hex: "#6B7C65 (reuse sage) or #4F7A52"
    use: "confirmations, healthy"
  - token: "--color-warning"
    proposed_hex: "#C4955A (reuse amber)"
    use: "caution, dormant"
  - token: "--color-danger"
    proposed_hex: "#C0573E (muted terracotta; destructive stays #d4183d)"
    use: "errors, destructive"
  - token: "--color-info"
    proposed_hex: "#4D7EA8 (reuse steel)"
    use: "informational"
```
> Principle: reuse brand hues for status where possible; only `danger` needs a dedicated warm-red. No `bg-green-50`/`bg-red-50`-style raw classes.

**Agentic / Operational-plane accent — DECISION PENDING (§9).** The 11 screens using `#6200EE` are the *Operational plane* (agents, rituals, tools, automation). Options in §9; until resolved, treat `#6200EE` as a placeholder mapping to the chosen token.

---

## 2. Typography (canonical — from `theme.css`)

**Families**
- `--font-ui: 'Geist'` — UI, labels, data, metadata, buttons, inputs, body.
- `--font-editorial: 'Source Serif 4'` — page/section/card headings, **Person names**, relationship context. (The editorial serif on names is a brand signature — humanizes the relationship layer.)
- Loaded via Google Fonts in `fonts.css`. *(Prod: self-host both for privacy + performance.)*

**Type scale** (element defaults already set; this is the canonical scale all `text-*` usage must map to):
```yaml
type_scale:
  - level: "h1 (page title)"
    font: Serif
    size: 32px
    weight: 400
    line: 1.2
    color: navy
  - level: "h2 (section)"
    font: Serif
    size: 24px
    weight: 600
    line: 1.2
    color: navy
  - level: "h3 (card / name)"
    font: Serif
    size: 18px
    weight: 500
    line: 1.2
    color: navy
  - level: "h4 (subhead)"
    font: Serif
    size: 16px
    weight: 500
    line: 1.2
    color: navy-mid
  - level: "body (p)"
    font: Geist
    size: 15px
    weight: 400
    line: 1.5
    color: navy-mid
  - level: button
    font: Geist
    size: 14px
    weight: 500
    line: 1.5
    color: "—"
  - level: input
    font: Geist
    size: 14px
    weight: 400
    line: 1.5
    color: "—"
  - level: label
    font: Geist
    size: 12px
    weight: 400
    line: 1.5
    color: navy-mid
  - level: "caption (min)"
    font: Geist
    size: 12px
    weight: 400/500
    line: 1.4
    color: warm-gray
```

**Weights:** 300 light · 400 normal · 500 medium · 600 semibold. **No `font-black`/700+** (off-scale). `font-bold` → prefer `font-semibold`.
**Tailwind `text-*` ↔ scale:** `text-2xl`=h2-ish, `text-xl`=h3, `text-lg`=h4, `text-base`=body, `text-sm`(14)=button/input, `text-xs`(12)=label/caption.
**A11y / minimum size:** **no text below 12px.** Replace all `text-[9px]/[10px]/[11px]` and inline `fontSize:'…'`. If a denser caption is truly needed, the floor is 11px and only for non-essential metadata — prefer 12px.

---

## 3. Spacing · Radius · Motion (canonical)

- **Spacing** (cozy): `--space-xs/sm/md/lg/xl/2xl` = 4/8/16/24/40/64px.
- **Radius:** card 12 · button 8 · pill 20 · avatar 50%. (`@theme` radius-sm 8 / md 12 / lg 12 / xl 16.)
- **Motion:** `--transition-fast` 200ms · `--transition-gentle` 400ms · `--transition-orbit` 2s. All ease-out. (Calm, never bouncy.)

---

## 4–8. (folded above)

---

## 9. Open decisions

**D1 — Operational/agentic accent.** The Operational plane currently uses electric Material purple (`#6200EE`), which is off-brand. Choose:
- **(a) Muted "agentic" accent token** *(recommended)* — add **one** restrained token, e.g. `--color-agentic: #6B6FB0` (muted iris), used only for Operational-plane surfaces (agents/rituals/tools/automation). Encodes the **two-plane architecture in color** (warm steel/sage = Mirror; cool iris = machinery) while staying premium. Replaces all `#6200EE`.
- **(b) Fold into steel/navy** — no new color; Operational uses the same brand blues as everything else. Maximally calm; loses the plane distinction.
- **(c) Keep a vivid accent** — a brighter (but non-Material) energy color.

**D2 — Dark mode.** Current `.dark` is half-baked (generic grays + purple). Choose:
- **(a) Defer for v1** *(recommended)* — ship warm-paper light only; remove the broken `.dark` block so it can't half-apply.
- **(b) Author Bridge dark now** — I build a real dark palette derived from brand tokens (warm-dark, not neutral gray).

---

## 10. Usage rules (lint-able)

1. **Tokens only.** No raw hex/`rgb()` in components; no `text-gray-*`/`bg-*-50` palette classes. Use brand tokens / semantic classes.
2. **Serif is for headings + names only.** Body/UI is Geist. No `font-serif` on body.
3. **Min 12px** type. No `text-[<12px]`, no inline `fontSize`.
4. **Weights 300–600** only.
5. **Warmth/relationship strength = hue + position, never a printed number.**
6. **One token source** (`theme.css`). Delete `default_shadcn_theme.css`; remove MUI/Emotion deps.

---

## 11. Remediation sequence (→ DESIGN-FIX **F0**, do before/with F1 vocab scrub)

1. **Cleanup:** delete `default_shadcn_theme.css`; remove `@mui/*` + `@emotion/*` from `package.json`; resolve D2 (drop or rebuild `.dark`).
2. **Token additions:** add status tokens (§1) + agentic token per **D1** to `theme.css` + expose in `@theme`.
3. **Codemod (mechanical, scoped):**
   - `#6200EE`/`#5000C9`/`#4C00B8` → agentic token (11 files).
   - cyan/teal `#00E5FF`/`#0099CC`/`#00897B` → steel-light / chosen accent.
   - near-dup hex (`#2a2a2a`→navy, `#fcfaf4`→background, `#6b7c65`→sage, `#c4955a`→amber…) → tokens.
   - `text-gray-900/700`→navy ink · `-500/-400`→navy-mid/warm-gray · `border-gray-*`→border · `bg-gray-50/100`→surface.
   - raw status classes → semantic status tokens.
   - `text-[9–11px]` + inline `fontSize` → scale classes (≥12px); `font-black`→`font-semibold`.
4. **Verify:** re-grep — raw hex ≈ 0 in components; no `text-[<12px]`; no `@mui`. (Optional: render prototype + screenshot before/after for a visual diff.)

---

## 12. Applied — 2026-05-31

**Decisions:** D1 = **fold agentic → steel/navy** (no new accent token). D2 = **authored Bridge dark now** (warm navy-charcoal; it also overrides the `--color-*` brand tokens — that omission was why the old `.dark` was broken).

**Done:**
- Foundation: status tokens (`--success/--warning/--danger/--info` + dark variants) in `theme.css`; real Bridge dark palette; deleted dead `default_shadcn_theme.css`; removed dead deps `@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled` (0 imports).
- Codemod, 4 passes. Class-form → `[var(--token)]` (themeable, flips in dark); bare inline/canvas hex → nearest brand hex (canvas-safe):
  - Material purple `#6200EE` / cyan / teal → steel / steel-light / sage.
  - `gray-*` ramp → navy / navy-mid / warm-gray / surface / border.
  - raw status colors → `--success/--warning/--danger/--info` (tints at low opacity).
  - `text-[9–11px]` → `text-xs`; `text-[13px]` → `text-sm`; `font-black` → `font-semibold`.
  - near-dup bare hex (`#2a2a2a`→navy, `#fcfaf4`→paper, `#dfd4c8`→border, …) → tokens.

**Scorecard (after):** raw gray classes **0** · raw status classes **0** · Material hex **0** · sub-12px **0** · `font-black` **0** · `[var(--token)]` classes **1668** · non-brand hex **0** (every remaining hex is a Bridge token; only `#fff` + one error-tint).

**Residual (minor, deferred):** `font-serif` utility ×6 (generic serif, not Source Serif 4 → add a `font-editorial` utility + map) · ~5 inline `fontSize:'NNpx'` one-offs · inline/canvas bare-hex brand colors won't flip in dark (canvas needs a JS color swap) · `bg-white`/`#fff` kept intentional.

**Runtime not yet verified:** prototype has no `node_modules`; the codemod only edited `className` strings + hex literals (no JSX structure), so it's build-safe by construction — but a `vite build`/preview for a visual before/after + breakage check is the recommended confirmation.
