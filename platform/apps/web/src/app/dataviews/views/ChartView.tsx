/**
 * ChartView — the one view that SUMMARISES instead of listing. Bar, line and
 * donut over a group-by column and an aggregate of a numeric column.
 *
 * The reductions come from `../aggregate.js`, the same module the table footer
 * already uses. A chart that averaged differently from the footer under it
 * would make one of the two numbers wrong, and nothing on screen would say
 * which — so there is one implementation, not two.
 *
 * Drawn in plain SVG. Three shapes did not justify adding a charting package
 * to a bundle that has none (ADR-247's "encode knowledge as data" applies to
 * the marks too: the geometry is derived from the buckets, never hardcoded).
 *
 * Shape and aggregate are LOCAL state; `ViewConfig` carries `groupBy` (shared
 * with the board) but has no field for either of the other two, and adding one
 * is a change to the grammar package, owned elsewhere.
 */
import { useMemo } from "react";
import { applyFilters, groupBy } from "@bridge/tables";
import { Button } from "../../components/ui/button.js";
import { StandardDropdown } from "../../components/shared/StandardDropdown.js";
import { GRAPH_PALETTE } from "../graph-palette.js";
import { computeAggregate, AGGREGATE_LABELS, type AggregateKind } from "../aggregate.js";
import type { DataViewProps } from "../types.js";

type ChartShape = "bar" | "line" | "donut";

/** The reductions a chart offers. `median`/`range`/`unique` belong on a footer,
 * not on an axis — a chart that offered every aggregate would offer several
 * that answer no question anyone asks of a category axis. */
const CHART_AGGREGATES: AggregateKind[] = ["count", "sum", "average", "min", "max"];

const GROUPABLE = new Set(["select", "multiselect", "status", "checkbox"]);
const NUMERIC = new Set(["number", "rollup", "formula", "autoNumber"]);

/** Plot geometry, in SVG user units. The viewBox scales it to any width. */
const W = 640;
const H = 260;
const PAD = { top: 12, right: 12, bottom: 34, left: 44 };

function tidy(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function ChartView({ spec, view, data, onViewChange }: DataViewProps) {
  // Shape, reduction and value column live in the saved View, not in local
  // state: a Chart the user set up and saved as a List must come back as the
  // same chart (2026-09-06).
  const shape = (view.chartShape ?? "bar") as ChartShape;
  const aggregate = (view.chartAggregate ?? "count") as AggregateKind;

  const groupableColumns = spec.columns.filter((column) => GROUPABLE.has(column.kind));
  const numericColumns = spec.columns.filter((column) => NUMERIC.has(column.kind));
  const groupField = view.groupBy ?? groupableColumns[0]?.id;
  const valueField = view.chartValueField ?? numericColumns[0]?.id;

  const buckets = useMemo(() => {
    if (!groupField) return [] as { key: string; value: number | null; count: number }[];
    const filtered = applyFilters(data, view.rowFilters, view.filterMatch);
    return groupBy(filtered, groupField).map(([key, rows]) => {
      const useCount = aggregate === "count" || !valueField;
      const values = useCount ? rows : rows.map((row) => row[valueField!]);
      const result = computeAggregate(values, useCount ? "count" : aggregate);
      return { key: key === "" ? "Empty" : key, value: result.value, count: rows.length };
    });
  }, [aggregate, data, groupField, valueField, view.filterMatch, view.rowFilters]);

  if (!groupField) {
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        Chart needs a column to group by. {spec.id} has no select, status or checkbox column.
      </div>
    );
  }

  const needsValue = aggregate !== "count";
  const plotted = buckets.filter((bucket) => bucket.value !== null);
  const max = Math.max(...plotted.map((bucket) => bucket.value ?? 0), 0);
  const total = plotted.reduce((sum, bucket) => sum + (bucket.value ?? 0), 0);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (value: number) => PAD.top + innerH - (max > 0 ? (value / max) * innerH : 0);
  const x = (index: number) =>
    PAD.left + (plotted.length === 1 ? innerW / 2 : (index / (plotted.length - 1)) * innerW);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border bg-background p-0.5">
          {(["bar", "line", "donut"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={shape === value ? "secondary" : "ghost"}
              className="h-7 capitalize"
              onClick={() => onViewChange({ ...view, chartShape: value })}
            >
              {value}
            </Button>
          ))}
        </div>
        {groupableColumns.length > 1 && (
          <StandardDropdown
            ariaLabel="Group by"
            activeId={groupField}
            options={groupableColumns.map((column) => ({ id: column.id, label: column.label }))}
            onSelect={(id) => onViewChange({ ...view, groupBy: id })}
          />
        )}
        <StandardDropdown
          ariaLabel="Aggregate"
          activeId={aggregate}
          options={CHART_AGGREGATES.map((kind) => ({ id: kind, label: AGGREGATE_LABELS[kind] }))}
          onSelect={(id) => onViewChange({ ...view, chartAggregate: id })}
        />
        {needsValue && numericColumns.length > 0 && (
          <StandardDropdown
            ariaLabel="Value column"
            activeId={valueField ?? null}
            options={numericColumns.map((column) => ({ id: column.id, label: `of ${column.label}` }))}
            onSelect={(id) => onViewChange({ ...view, chartValueField: id })}
          />
        )}
      </div>

      {needsValue && numericColumns.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {AGGREGATE_LABELS[aggregate]} needs a number column. {spec.id} has none — count works
          without one.
        </div>
      ) : plotted.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No {spec.id} records to summarise yet.
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${AGGREGATE_LABELS[aggregate]} by ${groupField}`}>
            {shape === "donut" ? (
              <Donut buckets={plotted} total={total} />
            ) : (
              <>
                <line
                  x1={PAD.left}
                  y1={PAD.top + innerH}
                  x2={W - PAD.right}
                  y2={PAD.top + innerH}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text x={4} y={PAD.top + 8} className="fill-muted-foreground" fontSize={11}>
                  {tidy(max)}
                </text>
                {shape === "bar"
                  ? plotted.map((bucket, index) => {
                      const barW = innerW / plotted.length;
                      const value = bucket.value ?? 0;
                      return (
                        <rect
                          key={bucket.key}
                          x={PAD.left + index * barW + barW * 0.15}
                          y={y(value)}
                          width={barW * 0.7}
                          height={Math.max(PAD.top + innerH - y(value), 1)}
                          fill={GRAPH_PALETTE[index % GRAPH_PALETTE.length]}
                          rx={2}
                        >
                          <title>{`${bucket.key}: ${tidy(value)}`}</title>
                        </rect>
                      );
                    })
                  : (
                    <>
                      <polyline
                        fill="none"
                        stroke={GRAPH_PALETTE[0]}
                        strokeWidth={2}
                        points={plotted.map((bucket, index) => `${x(index)},${y(bucket.value ?? 0)}`).join(" ")}
                      />
                      {plotted.map((bucket, index) => (
                        <circle key={bucket.key} cx={x(index)} cy={y(bucket.value ?? 0)} r={3} fill={GRAPH_PALETTE[0]}>
                          <title>{`${bucket.key}: ${tidy(bucket.value ?? 0)}`}</title>
                        </circle>
                      ))}
                    </>
                  )}
                {plotted.map((bucket, index) => (
                  <text
                    key={`label-${bucket.key}`}
                    x={shape === "bar" ? PAD.left + (index + 0.5) * (innerW / plotted.length) : x(index)}
                    y={H - 12}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    fontSize={11}
                  >
                    {bucket.key.length > 12 ? `${bucket.key.slice(0, 11)}…` : bucket.key}
                  </text>
                ))}
              </>
            )}
          </svg>

          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {plotted.map((bucket, index) => (
              <li key={bucket.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: GRAPH_PALETTE[index % GRAPH_PALETTE.length] }}
                />
                {bucket.key}: {tidy(bucket.value ?? 0)}
              </li>
            ))}
          </ul>
          {buckets.length > plotted.length && (
            <p className="text-xs text-muted-foreground">
              {buckets.length - plotted.length} group(s) have no number to{" "}
              {AGGREGATE_LABELS[aggregate].toLowerCase()} and are left off rather than drawn as zero.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Donut as stroked arcs on one circle — dasharray does the arithmetic. */
function Donut({
  buckets,
  total,
}: {
  buckets: { key: string; value: number | null }[];
  total: number;
}) {
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <g transform={`translate(${W / 2}, ${H / 2})`}>
      {total <= 0 ? (
        <text textAnchor="middle" dy={4} className="fill-muted-foreground" fontSize={13}>
          Nothing to divide — every group totals zero.
        </text>
      ) : (
        <>
          {buckets.map((bucket, index) => {
            const fraction = (bucket.value ?? 0) / total;
            const dash = fraction * circumference;
            const arc = (
              <circle
                key={bucket.key}
                r={radius}
                fill="none"
                stroke={GRAPH_PALETTE[index % GRAPH_PALETTE.length]}
                strokeWidth={34}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                transform="rotate(-90)"
              >
                <title>{`${bucket.key}: ${tidy(bucket.value ?? 0)}`}</title>
              </circle>
            );
            offset += dash;
            return arc;
          })}
          <text textAnchor="middle" dy={5} className="fill-foreground" fontSize={16}>
            {tidy(total)}
          </text>
        </>
      )}
    </g>
  );
}
