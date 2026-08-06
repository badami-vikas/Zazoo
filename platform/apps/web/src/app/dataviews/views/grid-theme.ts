/**
 * The Glide grid's visual language, expressed in Bridge tokens (ADR-182).
 *
 * WHY THIS FILE EXISTS. `GlideTableView` used to carry a `bridgeTheme` object of
 * frozen hex literals with the comment "Glide is canvas — no CSS vars". That is
 * true of the CANVAS, not of the APP: a canvas cannot resolve `var(--color-navy)`
 * at paint time, but JavaScript can resolve it once per theme change and hand
 * Glide the concrete value. Frozen literals meant the grid silently ignored the
 * `.dark` palette (its own comment admitted "this grid does not yet follow the
 * dark palette at all") and would drift the moment a brand token moved. Every
 * colour below is therefore READ FROM `styles/globals.css` at runtime and
 * recomputed when the `dark` class flips.
 *
 * WHAT THE SHAPE IS. The structural/typographic treatment is the Avilo Advisory
 * table's: a 10px uppercase letter-spaced faint header on a soft tint with a
 * single full-weight rule under it, 13px body text, 16px horizontal cell
 * padding, ~40px rows, NO vertical grid lines, near-invisible horizontal row
 * rules, no zebra striping, and a light accent wash on the hovered row. Only the
 * geometry and the hierarchy are borrowed; the palette stays Bridge's own warm
 * navy/parchment, which is why this is a token mapping and not a colour copy.
 *
 * Two things Glide's `Theme` cannot express — uppercase and letter-spacing on
 * the header — are painted by `makeDrawHeader`, a DECORATOR. `drawHeader` (like
 * `drawCell`) leaves cell kinds, the edit overlay and hit-testing untouched;
 * `customRenderers` would have replaced them.
 */
import { useEffect, useMemo, useState } from "react";
import type { DrawHeaderCallback, Theme } from "@glideapps/glide-data-grid";

// ── colour arithmetic ────────────────────────────────────────────────────────
// The tokens are hex; the grid needs tints and washes of them. Blending happens
// here, in sRGB, rather than being authored as a second set of literal hexes —
// a derived tint follows the token it derives from, a literal does not.

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(value: string, fallback: Rgb): Rgb {
  const hex = value.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** `t` of `b` blended into `a`. Opaque on purpose: Glide fills row and cell
 * backgrounds directly, so a translucent value would composite against whatever
 * happened to be underneath rather than against the cell colour. */
function mix(a: Rgb, b: Rgb, t: number): string {
  return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

function alpha({ r, g, b }: Rgb, a: number): string {
  return `rgba(${r},${g},${b},${a})`;
}

// ── token resolution ─────────────────────────────────────────────────────────

/** The Bridge custom properties this grid consumes, with the light-theme value
 * from `globals.css` as the fallback for a non-DOM render (tests, SSR). */
const TOKENS = {
  background: "#FAF9F5",
  surface: "#F0EEE8",
  navy: "#1A2B3C",
  navyMid: "#2E4057",
  warmGray: "#B8B4A8",
  border: "#E2DED5",
  steel: "#4D7EA8",
  amber: "#C4955A",
  danger: "#C0573E",
} as const;

type TokenName = keyof typeof TOKENS;

const CSS_VAR: Record<TokenName, string> = {
  background: "--color-background",
  surface: "--color-surface",
  navy: "--color-navy",
  navyMid: "--color-navy-mid",
  warmGray: "--color-warm-gray",
  border: "--color-border",
  steel: "--color-steel",
  amber: "--color-amber-soft",
  danger: "--danger",
};

const FALLBACK_FONT = "Geist, -apple-system, BlinkMacSystemFont, sans-serif";

export interface GridPalette {
  theme: Partial<Theme>;
  /** Row background for the hovered row — Glide has no hover colour of its own,
   * so it arrives through `getRowThemeOverride`. */
  hoverBg: string;
  /** `--danger`, for the red-flag glyph the canvas paints. */
  danger: string;
}

/** Geometry, in one place so the grid props and the zero-row overlay agree. */
export const GRID_ROW_HEIGHT = 40;
export const GRID_HEADER_HEIGHT = 36;
/** Avilo's `px-4`. */
const CELL_H_PADDING = 16;
/** Avilo's `py-2.5`, which is what makes a 13px row land at 40px. */
const CELL_V_PADDING = 10;
/** Avilo's `tracking-[0.07em]` at the header's 10px. */
const HEADER_TRACKING = 0.7;
const HEADER_FONT_STYLE = "600 10px";

function buildPalette(read: (name: TokenName) => string, fontFamily: string): GridPalette {
  const t = Object.fromEntries(
    (Object.keys(TOKENS) as TokenName[]).map((name) => [
      name,
      parseHex(read(name), parseHex(TOKENS[name], { r: 0, g: 0, b: 0 })),
    ]),
  ) as Record<TokenName, Rgb>;

  const bgCell = toHex(t.background);

  return {
    danger: toHex(t.danger),
    // Avilo's `hover:bg-accent-soft/40` — a wash of the accent, not a grey.
    hoverBg: mix(t.background, t.steel, 0.07),
    theme: {
      accentColor: toHex(t.steel),
      accentFg: bgCell,
      accentLight: alpha(t.steel, 0.12),

      textDark: toHex(t.navy),
      textMedium: toHex(t.navyMid),
      textLight: toHex(t.warmGray),
      textBubble: toHex(t.navy),
      // The header is deliberately the FAINTEST text on the surface (Avilo's
      // `text-ink-faint`): at 10px uppercase it reads as a label, so competing
      // with the data for contrast would invert the hierarchy.
      textHeader: toHex(t.warmGray),
      textHeaderSelected: toHex(t.navyMid),

      bgCell,
      // The row-marker gutter and the trailing "New row" tint.
      bgCellMedium: mix(t.background, t.surface, 0.55),
      bgHeader: toHex(t.surface),
      bgHeaderHovered: mix(t.surface, t.border, 0.35),
      bgHeaderHasFocus: mix(t.surface, t.border, 0.55),
      bgBubble: mix(t.background, t.surface, 0.6),
      bgBubbleSelected: toHex(t.surface),
      bgSearchResult: alpha(t.amber, 0.2),
      bgIconHeader: toHex(t.warmGray),
      fgIconHeader: bgCell,

      // NO VERTICAL RULES. Avilo draws none between data columns; the column
      // boundary is carried by the 16px gutter alone. `verticalBorder={false}`
      // on the editor is the real switch — this keeps anything Glide still
      // resolves through `borderColor` (the resize hairline, drag ghosts) from
      // reintroducing one.
      borderColor: alpha(t.border, 0),
      // Row rules are `border-line-soft`: present, but barely.
      horizontalBorderColor: mix(t.background, t.border, 0.55),
      // The ONE full-weight rule in the whole grid, exactly as in Avilo, where
      // the header is `border-b border-line` over `border-b border-line-soft`
      // rows.
      headerBottomBorderColor: toHex(t.border),
      drilldownBorder: toHex(t.border),
      resizeIndicatorColor: toHex(t.steel),
      linkColor: toHex(t.steel),

      cellHorizontalPadding: CELL_H_PADDING,
      cellVerticalPadding: CELL_V_PADDING,
      headerFontStyle: HEADER_FONT_STYLE,
      baseFontStyle: "13px",
      markerFontStyle: "11px",
      editorFontSize: "13px",
      fontFamily,
      lineHeight: 1.4,
      // Square cells. A rounded selection ring inside a grid with no vertical
      // rules reads as a floating chip rather than as a selected cell.
      roundingRadius: 0,
    },
  };
}

/**
 * Resolves the palette from the live document and rebuilds it when the theme
 * flips. `.dark` is a class on `<html>` (`@custom-variant dark (&:is(.dark *))`),
 * so a class MutationObserver is the whole signal — there is no theme context to
 * subscribe to, and polling `getComputedStyle` per frame would be a paint-path
 * cost for a value that changes about once a session.
 */
export function useGridPalette(): GridPalette {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setRevision((n) => n + 1));
    observer.observe(root, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => observer.disconnect();
  }, []);

  return useMemo(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return buildPalette((name) => TOKENS[name], FALLBACK_FONT);
    }
    const style = getComputedStyle(document.documentElement);
    const read = (name: TokenName) => {
      const value = style.getPropertyValue(CSS_VAR[name]).trim();
      return value === "" ? TOKENS[name] : value;
    };
    const font = style.getPropertyValue("--font-ui").trim();
    return buildPalette(read, font === "" ? FALLBACK_FONT : font);
    // `revision` is the dependency — the DOM read is not memoisable any other way.

  }, [revision]);
}

// ── header decorator ─────────────────────────────────────────────────────────

/** Per-character tracking. `ctx.letterSpacing` exists in current Chromium and
 * Safari 17.4+, but this grid also runs inside whatever WKWebView the host macOS
 * ships, so the spacing is applied by hand rather than gated on a feature that
 * would silently degrade to flat text on an older shell. */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
): number {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + tracking;
  }
  return cursor;
}

/** Avilo's 11px `ChevronDown`, rotated for ascending. */
function drawSortChevron(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  ascending: boolean,
): void {
  const w = 3.2;
  const h = 2.2;
  const dir = ascending ? -1 : 1;
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.moveTo(cx - w, cy - (h * dir) / 2);
  ctx.lineTo(cx, cy + (h * dir) / 2);
  ctx.lineTo(cx + w, cy - (h * dir) / 2);
  ctx.stroke();
  ctx.restore();
}

/** The ⋮ marker for the column menu. Glide's own marker is a chevron sprite in a
 * tinted box, which is a heavier affordance than this header can carry at 10px;
 * three dots at the faint text colour match the row menu's own ⋯ marker. The
 * marker is PAINT — `onHeaderMenuClick` still owns the hit region and opens the
 * real DOM `StandardColumnMenuPanel`. */
function drawMenuDots(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  opacity: number,
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  for (const dy of [-3.5, 0, 3.5]) {
    ctx.beginPath();
    ctx.arc(cx, cy + dy, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export interface HeaderSort {
  dir: "asc" | "desc";
  /** 1-based precedence, or `null` when there is only one sort. */
  rank: number | null;
}

/**
 * The header painter. Everything Glide's `Theme` cannot say — UPPERCASE, the
 * 0.07em tracking, a drawn sort chevron instead of an arrow glued onto the
 * title, and a lighter menu marker — is said here, and nothing else about the
 * header changes: the background, the bottom rule, hover tinting and every hit
 * region are still Glide's.
 */
export function makeDrawHeader(sortFor: (columnId: string) => HeaderSort | undefined): DrawHeaderCallback {
  return (args) => {
    const { ctx, rect, column, theme, isHovered, menuBounds } = args;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();

    const midY = rect.y + rect.height / 2;
    ctx.font = `${theme.headerFontStyle} ${theme.fontFamily}`;
    ctx.fillStyle = theme.textHeader;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const title = typeof column.title === "string" ? column.title : "";
    let cursor = drawTracked(ctx, title.toUpperCase(), rect.x + theme.cellHorizontalPadding, midY, HEADER_TRACKING);

    const sort = sortFor(String(column.id ?? ""));
    if (sort) {
      drawSortChevron(ctx, cursor + 5, midY, theme.textMedium, sort.dir === "asc");
      cursor += 14;
      if (sort.rank !== null) {
        ctx.fillStyle = theme.textLight;
        ctx.fillText(String(sort.rank), cursor, midY);
      }
    }

    if (column.hasMenu === true) {
      drawMenuDots(ctx, menuBounds.x + menuBounds.width / 2, midY, theme.textLight, isHovered ? 0.9 : 0.4);
    }

    ctx.restore();
  };
}
