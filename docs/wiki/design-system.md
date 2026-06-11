# Design system (wiki)

full: [../raw/DESIGN-SYSTEM.md](../raw/DESIGN-SYSTEM.md)

Source of truth in code = prototype `src/styles/theme.css` (good Bridge system ALREADY exists). Problem: components IGNORE it (hardcode). Align = make components consume tokens, NOT redesign.

**Mood**: warm paper + editorial serif + restrained steel. Calm/premium/trust-first. NOT loud SaaS.

**Color tokens**: bg `#FAF9F5` paper · surface `#F0EEE8` · navy `#1A2B3C` ink · navy-mid `#2E4057` body · **steel `#4D7EA8` primary** · steel-light `#7FA5C5` accent · warm-gray `#B8B4A8` · border `#E2DED5` · sage `#6B7C65` trust · amber `#C4955A` dormant. Relationship hues: warm=steel · trust=sage · dormant=amber · neutral=warm-gray (hue+position, NEVER a number).

**Type**: Geist (UI/data/body) + Source Serif 4 (headings + Person NAMES = brand signature). Scale: h1 32 / h2 24 / h3 18 / h4 16 serif · body 15 / btn 14 / input 14 / label 12 Geist. Weights 300–600 only. **Min 12px.**

**Spacing** 4/8/16/24/40/64 · **radius** card12 btn8 pill20 · **motion** 200/400/2000ms ease-out.

**Violations → tokens**: Material purple `#6200EE` ×226 (11 Operational/AI screens) + cyan/teal leak · raw `text-gray-*` ×~900 (clash warm paper) · raw status colors · ad-hoc `text-[9/10/11px]` + inline fontSize (a11y fail) · `font-black` strays · dead `default_shadcn_theme.css` + dead `@mui`/`@emotion` deps (0 imports) · broken dark mode.

**Open decisions**: D1 agentic accent (rec: add 1 muted iris `--color-agentic` for Operational plane → encodes two-plane in color) · D2 dark mode (rec: defer v1).

**Fix = DESIGN-FIX F0** (cleanup deps + delete dead css; add status+agentic tokens; codemod hex/grays/sizes → tokens; verify grep). Do before/with F1 vocab scrub.
