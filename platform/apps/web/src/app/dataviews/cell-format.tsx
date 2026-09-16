/**
 * Shared cell formatting for the `table` view kind (ADR-160, ADR-194).
 *
 * `TableView` reads its cell semantics from HERE rather than inlining them, so
 * a column's `display` hint means one thing on every surface that renders a
 * cell. This module exists because the formatting used to live inline in the
 * table, which is what made a second renderer re-implement (and drift from) the
 * ADR-155 glyphs.
 *
 * `formatCell` is the plain-text projection — it is what a red-flag anchor
 * records, so a flag raised against a badge cell carries the value the user
 * actually saw rather than the glyph's markup.
 *
 * `displayText` is the text-only form of a display-hinted cell. It has no
 * consumer in the app now that the canvas renderer is gone (ADR-194 restored
 * the rich DOM `renderCell` on every path); it is kept because it is the
 * projection any non-DOM consumer needs — CSV export, a plain-text digest — and
 * it is covered by tests.
 */
import type { ReactNode } from "react";
import { isMetadataColumn, type ColumnSpec } from "@bridge/tables";

/** Plain-text projection of a cell value. The red-flag anchor's `renderedValue`. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}


/**
 * A derived timestamp reads as an instant, not as an ISO string (TASK-063).
 * `createdBy`/`lastEditedBy` stay verbatim: they hold an actor id, and
 * prettifying an id into a name Bridge has not looked up would be a fabricated
 * attribution.
 */
function formatMetadata(col: ColumnSpec, value: unknown): string | null {
  if (!isMetadataColumn(col.kind)) return null;
  if (value === null || value === undefined || value === "") return "—";
  if (col.kind === "createdTime" || col.kind === "lastEditedTime") {
    const at = new Date(String(value));
    return Number.isNaN(at.getTime()) ? String(value) : at.toLocaleString();
  }
  return String(value);
}

// ── ADR-155 opt-in rich display ──────────────────────────────────────────────
// A column with no `display` hint renders as plain text in BOTH renderers.

/**
 * Badge tones carry an explicit dark variant. The light-only versions shipped
 * unnoticed for as long as the canvas renderer was in front of them — canvas
 * flattened every badge to plain text, so a light pill on a dark surface never
 * actually rendered. ADR-194 put the real glyphs back on screen, which is what
 * made the gap visible.
 */
const BADGE_TONES: Record<string, string> = {
  green:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/25",
  yellow:
    "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/25",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-400/25",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-400/25",
  gray: "bg-slate-50 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/25",
};

const RAG_DOT: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-rose-500",
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
  const metadata = formatMetadata(col, value);
  if (metadata !== null) return metadata;
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

// ── Kind-shaped cells (TASK-109) ─────────────────────────────────────────────
// Everything below renders a value AS ITS KIND. Until this landed the grid
// printed the literal text "true" for a checkbox, left a url as dead text and
// showed a date as its raw ISO string.

/** What a cell needs from its surface to be more than text. */
export interface CellContext {
  /** kind: "checkbox" — toggle in place. Absent = the row is not editable. */
  onToggle?: (next: boolean) => void;
  /** kind: "button" — run the column's Action. Absent = no runner is wired. */
  onRunAction?: (actionId: string) => void;
  /** Why this cell's own control cannot act, as the SERVER/surface said it. */
  disabledReason?: string;
}

/** A cell's own control must never also open the Record behind it. */
const stopRowOpen = (event: { stopPropagation: () => void }) => event.stopPropagation();

const CHIP =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset";

/** A status option's pill colour comes from its lifecycle group, so "done"
 *  reads the same in every Module without anyone painting it per Database. */
const STATUS_TONE = { todo: "gray", doing: "blue", done: "green" } as const;

function chips(values: unknown[]): ReactNode {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {values.map((entry, index) => (
        <span key={`${String(entry)}-${index}`} className={`${CHIP} ${BADGE_TONES.gray}`}>
          {String(entry)}
        </span>
      ))}
    </span>
  );
}

/** A bare "bridge.dev" is a relative path to the browser; only an absolute
 *  href actually opens. */
function externalHref(value: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}

function link(href: string, text: string): ReactNode {
  return (
    <a
      data-stop
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noreferrer" : undefined}
      onClick={stopRowOpen}
      className="underline underline-offset-2"
      style={{ color: "var(--color-steel)" }}
    >
      {text}
    </a>
  );
}

/** A local date, never an ISO string. Invalid input stays verbatim rather than
 *  becoming "Invalid Date" — a wrong-looking value beats a fabricated one. */
function localDate(value: unknown): ReactNode {
  const at = new Date(String(value));
  return Number.isNaN(at.getTime()) ? String(value) : at.toLocaleDateString();
}

/**
 * The kind-shaped rendering, or null when the kind has nothing special to say
 * and the plain-text projection is right.
 */
function renderByKind(col: ColumnSpec, value: unknown, ctx?: CellContext): ReactNode | null {
  // These two render at an empty value too: an unchecked box and an unpressed
  // button are states, not blanks.
  switch (col.kind) {
    case "checkbox":
      return (
        <input
          data-stop
          type="checkbox"
          checked={Boolean(value)}
          disabled={!ctx?.onToggle}
          title={ctx?.onToggle ? undefined : ctx?.disabledReason}
          aria-label={col.label}
          onClick={stopRowOpen}
          onChange={(event) => ctx?.onToggle?.(event.target.checked)}
          className="size-4 accent-current align-middle"
        />
      );
    case "button": {
      // A button column stores nothing; it runs a governed Action. With no
      // runner wired the control stays VISIBLE and says so (§3a) rather than
      // pretending to work.
      const reason = !col.actionId
        ? "Unavailable: this column names no Action to run"
        : !ctx?.onRunAction
          ? (ctx?.disabledReason ??
            "Unavailable: this surface has no Action runner wired, so the button has nothing to run")
          : undefined;
      return (
        <button
          data-stop
          type="button"
          disabled={Boolean(reason)}
          title={reason}
          onClick={(event) => {
            stopRowOpen(event);
            if (col.actionId) ctx?.onRunAction?.(col.actionId);
          }}
          className="rounded-md border px-2 py-0.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-60"
          style={{ borderColor: "var(--color-border)", color: "var(--color-navy)" }}
        >
          {col.label}
        </button>
      );
    }
    default:
      break;
  }

  if (value === null || value === undefined || value === "") return null;

  switch (col.kind) {
    case "url":
      return link(externalHref(String(value)), String(value));
    case "email":
      return link(`mailto:${String(value)}`, String(value));
    case "phone":
      return link(`tel:${String(value)}`, String(value));
    case "date":
      return localDate(value);
    case "multiselect":
      return chips(Array.isArray(value) ? value : String(value).split(",").map((v) => v.trim()));
    case "status": {
      const group = col.statusGroups?.[String(value)];
      const tone = BADGE_TONES[group ? STATUS_TONE[group] : "gray"];
      return <span className={`${CHIP} ${tone}`}>{String(value)}</span>;
    }
    case "autoNumber":
    case "number":
      return <span className="tabular-nums">{formatCell(value)}</span>;
    case "longText":
      // The full value is the tooltip: clamping must never be the only place a
      // sentence exists.
      return (
        <span className="line-clamp-2 whitespace-pre-line" title={String(value)}>
          {String(value)}
        </span>
      );
    case "files": {
      const count = Array.isArray(value) ? value.length : 1;
      return (
        <span className={`${CHIP} ${BADGE_TONES.gray}`}>
          {count} {count === 1 ? "file" : "files"}
        </span>
      );
    }
    case "person":
      return chips(Array.isArray(value) ? value : [value]);
    case "rollup":
      // Read-only by nature: nothing writes to a rollup, so it renders as the
      // derived value it is rather than as an editable-looking cell.
      return <span style={{ color: "var(--color-warm-gray)" }}>{formatCell(value)}</span>;
    default:
      return null;
  }
}

/** Rich DOM rendering for a cell. Canvas renderers use `displayText` instead. */
export function renderCell(col: ColumnSpec, value: unknown, ctx?: CellContext): ReactNode {
  const metadata = formatMetadata(col, value);
  if (metadata !== null) {
    return <span style={{ color: "var(--color-warm-gray)" }}>{metadata}</span>;
  }
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
              {/* The unfilled track is a token, not `bg-slate-100`: a fixed light
                  grey renders as a bright white bar on the dark surface. */}
              <span
                className="h-1.5 w-16 overflow-hidden rounded-full"
                style={{ background: "var(--color-line-soft)" }}
              >
                <span className={`block h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
              </span>
              <span
                className="text-xs tabular-nums"
                style={{ color: "var(--color-warm-gray)" }}
              >
                {pct}%
              </span>
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
  // The kind's own shape comes AFTER the display hint on purpose: a column that
  // opted into `badge`/`meter` asked for that glyph specifically, and its kind
  // must not quietly take the request back.
  return renderByKind(col, value, ctx) ?? formatCell(value);
}
