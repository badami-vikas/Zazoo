// MV3 service worker — the chrome glue around the pure pipeline in
// capture.ts. This file owns exactly three jobs: keep a policy cache warm,
// listen for completed page loads, and POST allowed visits to the local
// Bridge API. Everything decision-shaped lives in capture.ts / @bridge/core.
//
// Never runs in private windows: the manifest declares incognito
// "not_allowed", so Chrome does not load this worker for incognito
// contexts at all. The `tab.incognito` guard below is a visible restatement
// of that invariant, not the enforcement.
import {
  buildVisitPayload,
  decideVisit,
  dormantPolicy,
  VisitDeduper,
  type ExtensionCapturePolicy,
} from "./capture.js";

const POLICY_ALARM = "bridge-policy-refresh";
const POLICY_REFRESH_MINUTES = 5;

interface ExtensionConfig {
  apiUrl: string;
  organizationId: string;
  token: string;
}

/** The user pastes these in the popup; unset or partial config means the
 * extension stays dormant. The token is the user's own Bridge session
 * token — it never appears anywhere but chrome.storage.local. */
async function readConfig(): Promise<ExtensionConfig | null> {
  const stored = await chrome.storage.local.get(["apiUrl", "organizationId", "token"]);
  const apiUrl = typeof stored.apiUrl === "string" ? stored.apiUrl.trim().replace(/\/+$/, "") : "";
  const organizationId = typeof stored.organizationId === "string" ? stored.organizationId.trim() : "";
  const token = typeof stored.token === "string" ? stored.token.trim() : "";
  if (!apiUrl || !organizationId || !token) return null;
  return { apiUrl, organizationId, token };
}

/** In-memory policy cache. Dormant until a successful fetch says otherwise,
 * and dormant again on any fetch failure — an unreachable Bridge means no
 * capture, never stale capture. */
let policy: ExtensionCapturePolicy = dormantPolicy();
const deduper = new VisitDeduper();

async function refreshPolicy(): Promise<void> {
  const config = await readConfig();
  if (!config) {
    policy = dormantPolicy();
    return;
  }
  try {
    const input = encodeURIComponent(JSON.stringify({ organizationId: config.organizationId }));
    const response = await fetch(
      `${config.apiUrl}/trpc/learning.capture.browser.policy?input=${input}`,
      { headers: { authorization: `Bearer ${config.token}` } },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as {
      result?: { data?: { capturing?: boolean; allowlist?: string[]; denylist?: string[] } };
    };
    const data = body.result?.data;
    policy = {
      capturing: data?.capturing === true,
      allowlist: Array.isArray(data?.allowlist)
        ? data.allowlist.filter((d): d is string => typeof d === "string")
        : [],
      denylist: Array.isArray(data?.denylist)
        ? data.denylist.filter((d): d is string => typeof d === "string")
        : [],
    };
  } catch {
    policy = dormantPolicy();
  }
}

async function reportVisit(tabId: number, url: string, title: string): Promise<void> {
  const decision = decideVisit(policy, url);
  if (!decision.report) return;
  if (!deduper.shouldSend(tabId, decision.domain, title, Date.now())) return;
  const config = await readConfig();
  if (!config) return;
  const payload = buildVisitPayload({
    organizationId: config.organizationId,
    visitId: crypto.randomUUID(),
    domain: decision.domain,
    title,
    visitedAt: new Date().toISOString(),
  });
  try {
    await fetch(`${config.apiUrl}/trpc/learning.capture.browser.visit`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    // A dropped visit stays dropped — no retry queue; the next visit is a
    // fresh attempt, and the server-side id makes accidental retries safe.
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  if (!tab.url) return;
  if (tab.incognito) return; // see the manifest note at the top of this file
  void reportVisit(tabId, tab.url, tab.title ?? "");
});

chrome.tabs.onRemoved.addListener((tabId) => deduper.forget(tabId));

function armRefresh(): void {
  chrome.alarms.create(POLICY_ALARM, { periodInMinutes: POLICY_REFRESH_MINUTES });
  void refreshPolicy();
}

chrome.runtime.onInstalled.addListener(armRefresh);
chrome.runtime.onStartup.addListener(armRefresh);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLICY_ALARM) void refreshPolicy();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.apiUrl || changes.organizationId || changes.token) void refreshPolicy();
});
