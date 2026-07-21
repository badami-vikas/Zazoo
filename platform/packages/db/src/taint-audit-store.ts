import { and, asc, eq } from "drizzle-orm";
import {
  storedTaintLabelOrUnknown,
  type PersistedTaintSinkTrace,
  type TaintAuditStore,
  type TaintDeclassificationRecord,
  type TaintSinkId,
} from "@bridge/core";
import type { Database } from "./client.js";
import {
  taintDeclassifications,
  taintSinkTraces,
} from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

export class DrizzleTaintAuditStore implements TaintAuditStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async appendSinkTrace(trace: PersistedTaintSinkTrace): Promise<void> {
    await withOrganizationOnly(this.#db, trace.organizationId, async (tx) => {
      await tx
        .insert(taintSinkTraces)
        .values({
          id: trace.id,
          organizationId: trace.organizationId,
          ledgerId: trace.ledgerId,
          sink: trace.sink,
          taintLabel: trace.label,
          sourceChain: trace.sourceChain,
          policy: trace.policy,
          reason: trace.reason,
          traceHash: trace.traceHash,
          plane: trace.plane,
          createdAt: new Date(trace.createdAt),
        })
        .onConflictDoNothing();
    });
  }

  async appendDeclassification(
    record: TaintDeclassificationRecord,
  ): Promise<void> {
    await withOrganizationOnly(this.#db, record.organizationId, async (tx) => {
      await tx.insert(taintDeclassifications).values({
        id: record.id,
        organizationId: record.organizationId,
        beforeLabel: record.before,
        afterLabel: record.after,
        reason: record.reason,
        evidenceHash: record.evidenceHash,
        actorType: record.actor.type,
        actorId: record.actor.id,
        decisionLedgerId: record.decisionLedgerId,
        ruleId: record.rule?.id ?? null,
        ruleVersion: record.rule?.version ?? null,
        parentTraceHash: record.parentTraceHash,
        plane: record.plane,
        createdAt: new Date(record.createdAt),
      });
    });
  }

  async listSinkTraces(
    organizationId: string,
    ledgerId: string,
  ): Promise<PersistedTaintSinkTrace[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(taintSinkTraces)
        .where(
          and(
            eq(taintSinkTraces.organizationId, organizationId),
            eq(taintSinkTraces.ledgerId, ledgerId),
          ),
        )
        .orderBy(asc(taintSinkTraces.createdAt), asc(taintSinkTraces.id));
      return rows.map((row) => {
        const label = storedTaintLabelOrUnknown(row.taintLabel).label;
        return {
          id: row.id,
          organizationId: row.organizationId,
          ledgerId: row.ledgerId,
          sink: row.sink as TaintSinkId,
          label,
          sourceChain: label.originChain,
          policy: row.policy as PersistedTaintSinkTrace["policy"],
          reason: row.reason,
          traceHash: row.traceHash,
          createdAt: row.createdAt.toISOString(),
          plane: row.plane as "local" | "cloud",
        };
      });
    });
  }

  async listDeclassifications(
    organizationId: string,
    parentTraceHash: string,
  ): Promise<TaintDeclassificationRecord[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(taintDeclassifications)
        .where(
          and(
            eq(taintDeclassifications.organizationId, organizationId),
            eq(taintDeclassifications.parentTraceHash, parentTraceHash),
          ),
        )
        .orderBy(
          asc(taintDeclassifications.createdAt),
          asc(taintDeclassifications.id),
        );
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        before: storedTaintLabelOrUnknown(row.beforeLabel).label,
        after: storedTaintLabelOrUnknown(row.afterLabel).label,
        reason: row.reason,
        evidenceHash: row.evidenceHash,
        actor: {
          type: row.actorType as "user" | "validator",
          id: row.actorId,
        },
        decisionLedgerId: row.decisionLedgerId,
        rule:
          row.ruleId && row.ruleVersion
            ? { id: row.ruleId, version: row.ruleVersion }
            : null,
        createdAt: row.createdAt.toISOString(),
        parentTraceHash: row.parentTraceHash,
        plane: row.plane as "local" | "cloud",
      }));
    });
  }
}
