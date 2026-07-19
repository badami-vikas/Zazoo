import type { LedgerEntry, LedgerStore } from "@bridge/core";

interface LedgerPageOptions {
  limit: number;
  offset: number;
  privateOwnerUserId?: string;
}

interface LedgerPage {
  items: LedgerEntry[];
  total: number;
}

function newestFirst(left: LedgerEntry, right: LedgerEntry): number {
  const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (byTime !== 0) return byTime;
  return (right.appendSequence ?? 0) - (left.appendSequence ?? 0);
}

/**
 * Keeps private proposal payloads and their decision/audit descendants in the
 * Local Plane while retaining cloud Postgres for workspace/public audit rows.
 */
export class ResidencyRoutingLedgerStore implements LedgerStore {
  constructor(
    private readonly local: LedgerStore,
    private readonly cloud: LedgerStore,
  ) {}

  async append(entry: LedgerEntry): Promise<LedgerEntry> {
    if (entry.refLedgerId) {
      if (await this.local.get(entry.refLedgerId)) {
        return this.local.append(entry);
      }
      if (await this.cloud.get(entry.refLedgerId)) {
        return this.cloud.append(entry);
      }
    }
    // "all" may include relationship/private content, while an omitted scope is
    // the legacy unconstrained form. Only an explicitly public root is safe to
    // persist in Cloud Plane canonical storage.
    return entry.dataScope === "public"
      ? this.cloud.append(entry)
      : this.local.append(entry);
  }

  async get(id: string): Promise<LedgerEntry | null> {
    return (await this.local.get(id)) ?? this.cloud.get(id);
  }

  async decisionFor(proposalId: string): Promise<LedgerEntry | null> {
    return (
      (await this.local.decisionFor(proposalId)) ??
      this.cloud.decisionFor(proposalId)
    );
  }

  listPending(
    workspaceId: string,
    options: LedgerPageOptions,
  ): Promise<LedgerPage> {
    return this.#merge("listPending", workspaceId, options);
  }

  listHistory(
    workspaceId: string,
    options: LedgerPageOptions,
  ): Promise<LedgerPage> {
    return this.#merge("listHistory", workspaceId, options);
  }

  async #merge(
    method: "listPending" | "listHistory",
    workspaceId: string,
    options: LedgerPageOptions,
  ): Promise<LedgerPage> {
    const fetchOptions = {
      limit: options.limit + options.offset,
      offset: 0,
      ...(options.privateOwnerUserId
        ? { privateOwnerUserId: options.privateOwnerUserId }
        : {}),
    };
    const [local, cloud] = await Promise.all([
      this.local[method](workspaceId, fetchOptions),
      this.cloud[method](workspaceId, fetchOptions),
    ]);
    const seen = new Set<string>();
    const merged = [...local.items, ...cloud.items]
      .sort(newestFirst)
      .filter((entry) => {
        if (seen.has(entry.id)) {
          throw new Error(
            `Ledger entry ${entry.id} exists in both Local and Cloud Plane stores`,
          );
        }
        seen.add(entry.id);
        return true;
      });
    return {
      items: merged.slice(
        options.offset,
        options.offset + options.limit,
      ),
      total: local.total + cloud.total,
    };
  }
}
