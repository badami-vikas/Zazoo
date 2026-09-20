# Avatar Clipboard — standalone prototype

Ask the Avatar to **copy the details** on one page, see them in its chat window, then say **recall and paste**
on another form. The copied details live in `chrome.storage.local` on this machine and survive closing the
panel and restarting Chrome. No server, no build step, no dependency on the Bridge platform.

## Run

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Serve the demo pages (content scripts do not run on `file://` without an extra toggle):
   ```bash
   python3 -m http.server 8787 --directory demo
   ```
3. Open http://localhost:8787/source.html, click the extension icon (the side panel opens), type
   `copy the details`. The Avatar blinks and lists what it took.
4. Open http://localhost:8787/target.html, type `recall and paste`. Filled fields are outlined; the chat shows
   each target label and which source label it came from.
5. Quit Chrome, reopen, type `recall`: the details are still there.

Phrases: `copy` / `capture` / `grab` · `recall` / `show` · `paste` / `fill` · `forget` / `clear`.
Any page with a filled form works. On a page without a form, select text shaped like `Name: Jane` first.
Pages open before the extension was installed need one reload.

## Check

```bash
node test.cjs
```

## What it is not yet

- No document/PDF/screenshot extraction (Gaya's Super Copy) — capture reads form controls, `dt/dd`, `th/td`
  and selected `key: value` text only.
- Label mapping is a synonym table plus token overlap (`match.js`). Swap for a model when a real portal beats it.
- One clipboard, most recent record wins. No named clients, no team sharing, no per-carrier learned maps.
- Nothing is uploaded anywhere. When merged into Bridge the record becomes Module-associated Memory and the
  paste becomes a governed action (Avatar blink is the tell; raw capture stays Local).
