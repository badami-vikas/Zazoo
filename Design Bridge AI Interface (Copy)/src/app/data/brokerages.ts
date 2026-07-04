// Brokerages — a real entity (not just a filter label), so DealPilot's sourcing has somewhere to
// point. Lives under Intelligence → Apps, same "connect via API/waterfall" pattern as any other
// app: each brokerage gets its own ConnectAppFlow instance for credentials/login.
import { useSyncExternalStore } from 'react';

export interface Brokerage {
  id: string;
  name: string;
  portalUrl: string;
  status: 'connected' | 'disconnected';
  addedAt: string;
}

const K = 'dummy_bridge_brokerages_v1';

const SEED: Brokerage[] = [
  { id: 'dummy_brokerage_1', name: 'BizBuySell', portalUrl: 'https://www.bizbuysell.com', status: 'connected', addedAt: new Date().toISOString() },
  { id: 'dummy_brokerage_2', name: 'BusinessBroker.net', portalUrl: 'https://www.businessbroker.net', status: 'disconnected', addedAt: new Date().toISOString() },
];

function load(): Brokerage[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(K) : null;
    return raw ? JSON.parse(raw) : SEED;
  } catch {
    return SEED;
  }
}

let brokerages: Brokerage[] = load();

const subs = new Set<() => void>();
function persist() {
  try { localStorage.setItem(K, JSON.stringify(brokerages)); } catch { /* noop */ }
  subs.forEach((fn) => fn());
}
function subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn); }

export function useBrokerages(): Brokerage[] {
  return useSyncExternalStore(subscribe, () => brokerages, () => SEED);
}

/** Non-hook snapshot — for plain functions (e.g. data/dealpilot.ts's commitCapture) that need to
 * read the current brokerage list outside a component. */
export function getBrokerages(): Brokerage[] { return brokerages; }

export function addBrokerage(name: string, portalUrl: string): Brokerage {
  const b: Brokerage = { id: `dummy_brokerage_${Date.now()}`, name, portalUrl, status: 'disconnected', addedAt: new Date().toISOString() };
  brokerages = [...brokerages, b];
  persist();
  return b;
}

export function setBrokerageStatus(id: string, status: Brokerage['status']) {
  brokerages = brokerages.map((b) => (b.id === id ? { ...b, status } : b));
  persist();
}
