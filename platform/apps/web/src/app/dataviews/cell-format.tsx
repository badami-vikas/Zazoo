/**
 * Shared cell formatting for every `table`-kind renderer (ADR-160).
 *
 * Both table renderers — the DOM `TableView` and the canvas `GlideTableView` —
 * read their cell semantics from HERE, so a column's `display` hint means
 * exactly the same thing whichever renderer is on screen. Before this module
 * the formatting lived inline in TableView, which is why reviving a second
 * renderer previously meant re-implementing (and drifting) the ADR-155 glyphs.
 *
 * `formatCell` is the plain-text projection — it is what a red-flag anchor
 * records and what the canvas renderer paints, so a flag raised against a
 * badge cell carries the same `renderedValue` in both renderers.
 */
import type { ReactNode } from "react";
import type { ColumnSpec } from "@bridge/tables";

/** Plain-text projection of a cell value. The red-flag anchor's `renderedValue`. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

// ── ADR-155 opt-in rich display ──────────────────────────────────────────────
// A column with no `display` hint renders as plain text in BOTH renderers.

const BADGE_TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  yellow: "bg-amber-50 text-amber-700 ring-amber-600/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  gray: "bg-slate-50 text-slate-600 ring-slate-500/20",
};

const RAG_DOT: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-rose-500",
};

/** Canvas has no CSS classes — the same palette as concrete hex for Glide. */
export const RAG_HEX: Record<string, string> = {
  green: "#10b981",
  yellow: "#fbbf24",
  red: "#f43f5e",
};

/** Compact money label: 4_200_000 → "$4.2M", 68_000_000 → "$68M". */
export function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${trimZero(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}$${trimZero(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${trimZero(abs / 1_000)}K`;
  return `${sign}$${abs.toLocaleString()}`;
}

/** One decimal, but drop a trailing ".0" (18.0 → "18", 10.2 → "10.2"). */
export function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * Text form of a display-hinted cell — the single source of truth the canvas
 * renderer paints and the DOM renderer falls back to. Keeping this separate
 * from `renderCell` is what lets both renderers agree without sharing JSX.
 */
export function displayText(col: ColumnSpec, value: unknown): string {
  if (col.display && value !== null && value !== undefined && value !== "") {
    switch (col.display) {
      case "badge":
        return col.badgeLabels?.[String(value)] ?? formatCell(value);
      case "rag":
        return String(value);
      case "meter": {
        const pct = Math.max(0, Math.min(100, Number(value)));
        if (!Number.isNaN(pct)) return `${pct}%`;
        break;
      }
      case "currency": {
        const n = Number(value);
        if (!Number.isNaN(n)) return formatCurrency(n);
        break;
      }
      case "multiple": {
        const n = Number(value);
        if (!Number.isNaN(n)) return `${trimZero(n)}×`;
        break;
      }
    }
  }
  return formatCell(value);
}

/** Rich DOM rendering for a cell. Canvas renderers use `displayText` instead. */
export function renderCell(col: ColumnSpec, value: unknown): ReactNode {
  if (col.display && value !== null && value !== undefined && value !== "") {
    switch (col.display) {
      case "rag": {
        const tone = RAG_DOT[String(value)];
        if (tone) {
          return (
            <span className="inline-flex items-center" title={String(value)}>
              <span className={`inline-block size-2.5 rounded-full ${tone}`} aria-label={String(value)} />
            </span>
          );
        }
        break;
      }
      case "badge": {
        const tone = BADGE_TONES[col.badgePalette?.[String(value)] ?? "gray"];
        const label = col.badgeLabels?.[String(value)] ?? formatCell(value);
        return (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
          >
            {label}
          </span>
        );
      }
      case "meter": {
        const pct = Math.max(0, Math.min(100, Number(value)));
        if (!Number.isNaN(pct)) {
          const bar = pct >= 70 ? RAG_DOT.green : pct >= 40 ? RAG_DOT.yellow : RAG_DOT.red;
          return (
            <span className="inline-flex items-center gap-2" title={`${pct}%`}>
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                <span className={`block h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
              </span>
              <span className="text-xs tabular-nums text-slate-500">{pct}%</span>
            </span>
          );
        }
        break;
      }
      case "currency": {
        const n = Number(value);
        if (!Number.isNaN(n)) return <span className="tabular-nums">{formatCurrency(n)}</span>;
        break;
      }
      case "multiple": {
        const n = Number(value);
        if (!Number.isNaN(n)) return <span className="tabular-nums">{trimZero(n)}×</span>;
        break;
      }
    }
  }
  return formatCell(value);
}
