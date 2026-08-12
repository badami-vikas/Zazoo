# Bridge — Activity Capture extension (K8)

Reports **domain/title-level** visits on allowlisted domains to the local Bridge API as
observed-signal Memories. No page content, no URLs (the hostname is extracted in-browser and
the payload has no url field), and never in private windows — the manifest declares
`"incognito": "not_allowed"`, so the capture path is absent there, not filtered.

## Build & load

```bash
pnpm --filter @bridge/browser-extension build
```

Then in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** →
`platform/apps/browser-extension/dist/extension`.

## Configure

Open the extension popup and paste your Bridge API URL (default `http://localhost:4000`),
Organization ID, and your own access token. Capture stays dormant until Bridge Settings has
the **Browser visits** source turned on AND an allowlist saved — the empty allowlist
captures nothing (default-deny), and the denylist always wins.
