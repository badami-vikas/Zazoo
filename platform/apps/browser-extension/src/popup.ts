// Popup — configuration and an honest status line. The user pastes their
// own Bridge API URL, Organization id, and access token; nothing here ever
// captures, and the status is a read of the same policy endpoint the
// worker polls.

const DEFAULT_API_URL = "http://localhost:4000";

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing popup control: ${id}`);
  return found as T;
}

const apiUrlInput = el<HTMLInputElement>("apiUrl");
const organizationIdInput = el<HTMLInputElement>("organizationId");
const tokenInput = el<HTMLInputElement>("token");
const statusLine = el<HTMLParagraphElement>("status");

function setStatus(text: string, bad = false): void {
  statusLine.textContent = text;
  statusLine.className = bad ? "bad" : "";
}

async function checkPolicy(): Promise<void> {
  const apiUrl = apiUrlInput.value.trim().replace(/\/+$/, "");
  const organizationId = organizationIdInput.value.trim();
  const token = tokenInput.value.trim();
  if (!apiUrl || !organizationId || !token) {
    setStatus("Not configured yet — capture is dormant.");
    return;
  }
  try {
    const input = encodeURIComponent(JSON.stringify({ organizationId }));
    const response = await fetch(`${apiUrl}/trpc/learning.capture.browser.policy?input=${input}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as {
      result?: { data?: { capturing?: boolean; paused?: boolean; allowlist?: string[] } };
    };
    const data = body.result?.data;
    if (data?.capturing) {
      const count = data.allowlist?.length ?? 0;
      setStatus(
        count === 0
          ? "Capture is on, but the allowlist is empty — nothing is captured until you add domains in Bridge Settings."
          : `Capturing visits on ${count} allowlisted domain${count === 1 ? "" : "s"}.`,
      );
    } else {
      setStatus(
        data?.paused
          ? "Paused — the capture kill switch is on in Bridge Settings."
          : "Dormant — browser capture is off in Bridge Settings.",
      );
    }
  } catch {
    setStatus(`Can't reach Bridge at ${apiUrl} — capture is dormant.`, true);
  }
}

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get(["apiUrl", "organizationId", "token"]);
  apiUrlInput.value = typeof stored.apiUrl === "string" && stored.apiUrl ? stored.apiUrl : DEFAULT_API_URL;
  organizationIdInput.value = typeof stored.organizationId === "string" ? stored.organizationId : "";
  tokenInput.value = typeof stored.token === "string" ? stored.token : "";
  await checkPolicy();
}

el<HTMLButtonElement>("save").addEventListener("click", () => {
  void (async () => {
    await chrome.storage.local.set({
      apiUrl: apiUrlInput.value.trim(),
      organizationId: organizationIdInput.value.trim(),
      token: tokenInput.value.trim(),
    });
    setStatus("Saved.");
    await checkPolicy();
  })();
});

void load();
