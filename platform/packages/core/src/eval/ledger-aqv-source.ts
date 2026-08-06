/**
 * LedgerAqvSource — the join between the governed audit spine and the Agent
 * Quality Vector.
 *
 * Before this existed, the eval harness was fully built and structurally unable to
 * run: `AqvSource` had no implementation anywhere, so `scoreCapability` could only
 * ever be handed hand-written test fixtures. Every input it needs was already being
 * persisted on the ledger — the decision a Human made, the diff they edited, the
 * policies that fired — but nothing mapped those rows into `AqvRecord`s, and no row
 * recorded WHICH capability produced it.
 *
 * The attribution key is `LedgerEntry.skill` (persisted by migration 0037). For a
 * Skill capability the Skill id and the Commons manifest id are the same string, so
 * grouping ledger rows by `skill` scores a real capability from real episodes.
 *
 * What this deliberately does NOT do:
 *
 * - It does not invent attribution for pre-0037 rows. A row with no `skill` is
 *   excluded, not bucketed by `action` or `resourceType` guesswork. An empty score
 *   is an honest "not measured yet"; a guessed one silently moves a promotion gate.
 *
 * - It counts each governed episode ONCE. propose→decide writes two rows for one
 *   Skill execution (a proposal row with `userDecision: null`, then a decision row
 *   carrying `refLedgerId`). Counting both would double every reviewed episode and
 *   systematically inflate capabilities that route through human review relative to
 *   auto-approved ones. Decision rows supersede the proposal they resolve.
 */
import { computeAqv, type AQV, type AqvEvidence, type AqvRecord, type AqvSource, type AqvWindow } from "./aqv.js";
import type { LedgerEntry } from "../types.js";

/** The read side this adapter needs. `LedgerStore.listHistory` satisfies it. */
export interface AqvLedgerReader {
  listHistory(
    organizationId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: LedgerEntry[]; total: number }>;
}

/** Supplies the violation count the safety axis vetoes on (capability_states.evidence). */
export interface AqvEvidenceReader {
  evidenceFor(capabilityId: string): Promise<AqvEvidence | undefined>;
}

export interface LedgerAqvSourceOptions {
  /** Rows fetched per page while walking history. */
  pageSize?: number;
  /** Hard ceiling on rows scanned for one scoring call, so an append-only table
   * that grows without bound cannot turn a score into an unbounded query. */
  maxRows?: number;
}

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_ROWS = 5_000;

/**
 * Collapses a page of ledger rows into one `AqvRecord` per governed episode.
 *
 * Exported for testing and because the de-duplication rule is the subtle part: a
 * decision row REPLACES the proposal row it references, keeping the proposal's
 * creation time (when the Skill actually ran) and the decision's verdict and diff.
 */
export function episodesFromLedger(rows: readonly LedgerEntry[], capabilityId: string): AqvRecord[] {
  const scoped = rows.filter((row) => row.skill === capabilityId);

  // Proposal rows, keyed by id. A decision row resolves one of these.
  const byId = new Map<string, LedgerEntry>();
  for (const row of scoped) {
    if (!row.refLedgerId) byId.set(row.id, row);
  }

  const superseded = new Set<string>();
  const episodes: AqvRecord[] = [];

  for (const row of scoped) {
    if (!row.refLedgerId) continue;
    const proposal = byId.get(row.refLedgerId);
    if (proposal) superseded.add(proposal.id);
    const snapshot = row.executionSnapshot ?? proposal?.executionSnapshot;
    episodes.push({
      id: row.refLedgerId,
      // The proposal's timestamp is when the Skill ran; the decision may land days
      // later. Windowing on the decision time would move episodes between windows
      // based on how fast a Human got to their inbox.
      createdAt: proposal?.createdAt ?? row.createdAt,
      userDecision: row.userDecision,
      ...(row.diff !== undefined ? { diff: row.diff } : {}),
      ...(snapshot ? { executionSnapshot: snapshot } : {}),
      ...(row.policyResults ? { policyResults: row.policyResults } : {}),
    });
  }

  for (const row of scoped) {
    if (row.refLedgerId) continue;
    if (superseded.has(row.id)) continue;
    episodes.push({
      id: row.id,
      createdAt: row.createdAt,
      userDecision: row.userDecision,
      ...(row.diff !== undefined ? { diff: row.diff } : {}),
      ...(row.executionSnapshot ? { executionSnapshot: row.executionSnapshot } : {}),
      ...(row.policyResults ? { policyResults: row.policyResults } : {}),
    });
  }

  return episodes;
}

export class LedgerAqvSource implements AqvSource {
  readonly #ledger: AqvLedgerReader;
  readonly #organizationId: string;
  readonly #evidence: AqvEvidenceReader | undefined;
  readonly #pageSize: number;
  readonly #maxRows: number;

  constructor(
    ledger: AqvLedgerReader,
    organizationId: string,
    evidence?: AqvEvidenceReader,
    options: LedgerAqvSourceOptions = {},
  ) {
    this.#ledger = ledger;
    this.#organizationId = organizationId;
    this.#evidence = evidence;
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.#maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  }

  async listAqvRecords(
    capabilityId: string,
    window: AqvWindow,
  ): Promise<{ records: AqvRecord[]; evidence?: AqvEvidence }> {
    const rows: LedgerEntry[] = [];
    let offset = 0;

    // listHistory is newest-first. Once a page is entirely older than the window's
    // lower bound, every later page is too — stop rather than walk all of history.
    for (;;) {
      const page = await this.#ledger.listHistory(this.#organizationId, {
        limit: this.#pageSize,
        offset,
      });
      if (page.items.length === 0) break;
      rows.push(...page.items);
      offset += page.items.length;

      if (window.from) {
        const oldest = page.items[page.items.length - 1];
        if (oldest && Date.parse(oldest.createdAt) < Date.parse(window.from)) break;
      }
      if (offset >= page.total || rows.length >= this.#maxRows) break;
    }

    const records = episodesFromLedger(rows, capabilityId);
    const evidence = await this.#evidence?.evidenceFor(capabilityId);
    return { records, ...(evidence ? { evidence } : {}) };
  }
}

/** Convenience: score one capability straight from the ledger. */
export async function scoreCapabilityFromLedger(
  ledger: AqvLedgerReader,
  organizationId: string,
  capabilityId: string,
  window: AqvWindow = {},
  evidence?: AqvEvidenceReader,
): Promise<AQV> {
  const source = new LedgerAqvSource(ledger, organizationId, evidence);
  const { records, evidence: found } = await source.listAqvRecords(capabilityId, window);
  return computeAqv(records, window, found ?? {});
}
