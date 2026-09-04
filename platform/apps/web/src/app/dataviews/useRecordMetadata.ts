/**
 * The four derived metadata columns, fetched for the rows on screen (TASK-063).
 *
 * The shell owns this for the same reason it owns saved Lists: a per-page
 * opt-in would be one chance to forget per page. It asks only when the spec
 * actually declares one of the metadata kinds, so a Database that does not want
 * them pays nothing.
 *
 * `entityType` is what the Event log keys on. Without it there is nothing to
 * ask for, and the columns render honestly empty rather than showing a
 * fabricated time.
 */
import { useEffect, useState } from "react";
import { isMetadataColumn, type TableSpec } from "@bridge/tables";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";
import type { DataRow } from "./types";

export interface RecordMetadata {
  createdTime: string | null;
  createdBy: string | null;
  lastEditedTime: string | null;
  lastEditedBy: string | null;
}

export function specWantsMetadata(spec: TableSpec): boolean {
  return spec.columns.some((column) => isMetadataColumn(column.kind));
}

function rowId(row: DataRow): string | null {
  const id = row["id"];
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

/**
 * Rows with the metadata columns filled in. Returns the input unchanged when
 * the spec asks for none, so the common path allocates nothing.
 */
export function useRecordMetadata(
  spec: TableSpec,
  rows: DataRow[],
  entityType: string | undefined,
): DataRow[] {
  const [byId, setById] = useState<Record<string, RecordMetadata>>({});
  const wanted = specWantsMetadata(spec);
  // A stable key, so the effect re-runs when the ROW SET changes rather than on
  // every render that produced a new array with the same rows in it.
  const ids = rows.map(rowId).filter((id): id is string => id !== null);
  const idKey = ids.join(",");

  useEffect(() => {
    if (!wanted || !entityType || idKey === "") return;
    let cancelled = false;
    void (async () => {
      try {
        const answer = (await trpc.records.metadata.query({
          organizationId: PILOT_ORGANIZATION,
          entityType,
          recordIds: idKey.split(","),
        })) as Record<string, RecordMetadata>;
        if (!cancelled) setById(answer);
      } catch {
        // A metadata read that fails leaves the cells empty. It must never take
        // the table down with it — the Records are the point, this is chrome.
        if (!cancelled) setById({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, entityType, idKey]);

  if (!wanted) return rows;
  return rows.map((row) => {
    const id = rowId(row);
    const meta = id ? byId[id] : undefined;
    return meta ? { ...row, ...meta } : row;
  });
}
