// LOCAL plane for the Camera tool. Blobs + capture metadata + the governed intake
// review mirror live in IndexedDB on this device — NEVER Supabase/cloud (private
// relationship data, dataScope:'private', private ∩ egress = none). The server Action
// Pipeline remains authoritative for capture proposals and decisions; this store only
// tracks Local Media state after those governed operations succeed.
import { openDB, type IDBPDatabase } from 'idb';

export type MediaKind = 'photo' | 'video';
export type MediaStatus = 'pending' | 'committed' | 'archived';

export interface MediaCaptureRecord {
  id: string;
  workspaceId: string;
  kind: MediaKind;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  caption?: string;
  ocrText?: string;
  thumbnailDataUrl?: string;
  status: MediaStatus;
  ledgerId?: string;
  linkedEntity?: { type: 'person' | 'memory' | 'event' | 'touchpoint'; id: string } | null;
  provenance: { tool: string; version: string; model?: string };
  capturedAt: string;
  archivedAt?: string | null;
}

// Append-only governed ledger row — mirrors @bridge/core LedgerEntry (subset).
export type Decision = 'approve' | 'veto' | 'edit';
export interface MediaLedgerEntry {
  id: string;
  mediaId: string;
  resourceType: 'event' | 'touchpoint' | 'signal';
  proposedOutput: unknown;
  userDecision: Decision | 'auto' | null; // null = pending_review
  refLedgerId?: string;                    // decision row → proposal row
  createdAt: string;
}

const DB_NAME = 'bridge.localMedia.v1';
const STORE_MEDIA = 'captures';
const STORE_BLOBS = 'blobs';
const STORE_LEDGER = 'ledger';
const WORKSPACE = 'ws_local'; // single local workspace in the prototype

let dbp: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE_MEDIA)) d.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(STORE_BLOBS)) d.createObjectStore(STORE_BLOBS);
        if (!d.objectStoreNames.contains(STORE_LEDGER)) d.createObjectStore(STORE_LEDGER, { keyPath: 'id' });
      },
    });
  }
  return dbp;
}

function uid(prefix: string): string {
  return `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`)}`;
}

// ── LocalMediaStore (blob stays on-device) ──────────────────────────────────────
export async function putCapture(
  rec: Omit<MediaCaptureRecord, 'id' | 'workspaceId' | 'status' | 'capturedAt'> & Partial<Pick<MediaCaptureRecord, 'id'>>,
  blob: Blob,
): Promise<MediaCaptureRecord> {
  const d = await db();
  const full: MediaCaptureRecord = {
    id: rec.id ?? uid('media'),
    workspaceId: WORKSPACE,
    status: 'pending',
    capturedAt: new Date().toISOString(),
    ...rec,
  };
  if (await d.get(STORE_MEDIA, full.id)) throw new Error(`media: duplicate id ${full.id}`);
  await d.put(STORE_MEDIA, full);
  await d.put(STORE_BLOBS, blob, full.id);
  return full;
}

export async function getCapture(id: string): Promise<MediaCaptureRecord | null> {
  return (await (await db()).get(STORE_MEDIA, id)) ?? null;
}
export async function getBlob(id: string): Promise<Blob | null> {
  return (await (await db()).get(STORE_BLOBS, id)) ?? null;
}
export async function getBlobUrl(id: string): Promise<string | null> {
  const b = await getBlob(id);
  return b ? URL.createObjectURL(b) : null;
}
export async function listCaptures(filter?: { status?: MediaStatus; kind?: MediaKind }): Promise<MediaCaptureRecord[]> {
  const all = (await (await db()).getAll(STORE_MEDIA)) as MediaCaptureRecord[];
  return all
    .filter((r) => (filter?.status ? r.status === filter.status : true))
    .filter((r) => (filter?.kind ? r.kind === filter.kind : true))
    .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
}
async function patchCapture(id: string, patch: Partial<MediaCaptureRecord>): Promise<MediaCaptureRecord> {
  const d = await db();
  const cur = (await d.get(STORE_MEDIA, id)) as MediaCaptureRecord | undefined;
  if (!cur) throw new Error(`media: no record ${id}`);
  const next: MediaCaptureRecord = { ...cur, ...patch, id: cur.id, workspaceId: cur.workspaceId, kind: cur.kind, byteSize: cur.byteSize };
  await d.put(STORE_MEDIA, next);
  return next;
}
export async function archiveCapture(id: string): Promise<void> {
  await patchCapture(id, { status: 'archived', archivedAt: new Date().toISOString() });
}

// ── Local review mirror (the server Action Pipeline is authoritative) ───────────
export interface ProposalView {
  id: string;
  mediaId: string;
  resourceType: 'event';
  proposedOutput: unknown;
  status: 'pending_review' | 'applied' | 'rejected';
}

async function appendLedger(entry: MediaLedgerEntry): Promise<MediaLedgerEntry> {
  const d = await db();
  if (await d.get(STORE_LEDGER, entry.id)) throw new Error(`ledger: duplicate id ${entry.id}`);
  await d.put(STORE_LEDGER, entry);
  return entry;
}
export async function listLedger(): Promise<MediaLedgerEntry[]> {
  const all = (await (await db()).getAll(STORE_LEDGER)) as MediaLedgerEntry[];
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export async function listProposals(): Promise<ProposalView[]> {
  const led = await listLedger();
  const proposals = led.filter(
    (entry) =>
      entry.resourceType === 'event' &&
      entry.userDecision === null &&
      !entry.refLedgerId,
  );
  return proposals.map((p) => {
    const decided = led.find((e) => e.refLedgerId === p.id);
    const status: ProposalView['status'] = !decided
      ? 'pending_review'
      : decided.userDecision === 'veto' ? 'rejected' : 'applied';
    return { id: p.id, mediaId: p.mediaId, resourceType: 'event', proposedOutput: p.proposedOutput, status };
  });
}

/** Mirror a server-owned pending capture proposal without claiming local authority. */
export async function mirrorCaptureProposal(
  proposalId: string,
  mediaId: string,
  proposedOutput: unknown,
): Promise<ProposalView> {
  if (!(await getCapture(mediaId))) throw new Error(`proposal mirror: no capture ${mediaId}`);
  const existing = (await listLedger()).find((entry) => entry.id === proposalId);
  if (existing) {
    if (existing.mediaId !== mediaId || existing.resourceType !== 'event') {
      throw new Error(`proposal mirror: conflicting proposal ${proposalId}`);
    }
    return { id: proposalId, mediaId, resourceType: 'event', proposedOutput: existing.proposedOutput, status: 'pending_review' };
  }
  const entry = await appendLedger({
    id: proposalId, mediaId, resourceType: 'event', proposedOutput,
    userDecision: null, createdAt: new Date().toISOString(),
  });
  return { id: entry.id, mediaId, resourceType: 'event', proposedOutput, status: 'pending_review' };
}

/** Mirror a successful server decision, then update only the device-local media row. */
export async function mirrorCaptureDecision(
  proposalId: string,
  decision: Exclude<Decision, 'edit'>,
  decisionLedgerId: string,
  eventId: string,
): Promise<ProposalView> {
  const led = await listLedger();
  const proposal = led.find((e) => e.id === proposalId && e.userDecision === null);
  if (!proposal || proposal.resourceType !== 'event') {
    throw new Error(`decision mirror: no pending Event proposal ${proposalId}`);
  }
  const priorDecision = led.find((entry) => entry.refLedgerId === proposalId);
  if (priorDecision && priorDecision.userDecision !== decision) {
    throw new Error(`decision mirror: ${proposalId} has a conflicting decision`);
  }
  const decisionRow = priorDecision ?? await appendLedger({
    id: decisionLedgerId,
    mediaId: proposal.mediaId,
    resourceType: 'event',
    proposedOutput: proposal.proposedOutput,
    userDecision: decision,
    refLedgerId: proposalId,
    createdAt: new Date().toISOString(),
  });
  if (decision === 'approve') {
    await patchCapture(proposal.mediaId, {
      status: 'committed',
      ledgerId: decisionRow.id,
      linkedEntity: { type: 'event', id: eventId },
    });
  }
  return {
    id: decisionRow.id,
    mediaId: proposal.mediaId,
    resourceType: 'event',
    proposedOutput: proposal.proposedOutput,
    status: decision === 'veto' ? 'rejected' : 'applied',
  };
}
