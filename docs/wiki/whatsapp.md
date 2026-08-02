# WhatsApp Module

**TASK-029 IN PROGRESS.** Nav entry → owner's own WhatsApp Web session inside desktop shell. Tools = add-on Page.

## Shape

- **Chats Page** — real `web.whatsapp.com` in contained Tauri webview, pinned to Page rect. Reads as embedded.
- **Tools Page** — Tool registry. v1 = **Contact Extractor**.
- Desktop only. Browser/mobile = honest unavailable state. Browser cannot host session: WhatsApp refuses framing, no cross-origin injection.

## Engine

Vendored + SHA-256-pinned `@wppconnect/wa-js` (Apache-2.0) injected at document start. Runs WhatsApp's OWN client code → lowest enforcement exposure of the options. NOT whatsapp-web.js (bundles Chromium), NOT Baileys (reimplements protocol), NOT own scraping (brittle). See [decisions](decisions.md) ADR-157.

## Containment

Same pattern as research webview + narrower:

- Window label absent from capabilities → no Tauri IPC on page.
- Navigation: `whatsapp.com`/`whatsapp.net` ONLY. Live authenticated session — open redirect must never carry it out.
- Outbound-only reporting via cancelled `bridge-wa:` navigation.
- **Op allowlist** (`script_for_op`): web app names an op, never supplies JS. Group ids validated before interpolation.
- `build.rs` fails build on wa-js hash mismatch.

v1 read ops: `list_contacts`, `list_groups`, `group_participants`, `list_direct_chats`, `pn_lid_map`.

## Three facts you must know

1. **UA.** WKWebView default UA → WhatsApp "update Safari" wall. Needs explicit Safari `Version/` token. Load-bearing.
2. **Session persists** across restart despite logged `aquire-persistent-storage-denied`. Error is noisy, not fatal.
3. **Liveness ≠ `WPP.isReady`.** That flag flips false after socket connects. Live = CONNECTED socket + populated chat store. Reading earlier → "sendIq called before startComms".

## LID — the big trap

WhatsApp Linked IDs (`@lid`) are **opaque handles, not phone numbers**. Measured live: 4,203 of 8,384 contacts. Splitting one into digits mints a fake phone number.

- `phoneFor` short-circuits on the id — guarding only the suffix is NOT enough, an extractor that strips `@lid` into a `phone` field slips past.
- LID keys (`whatsapp-lid:`) and phone keys (`whatsapp:+E164`) are **disjoint**. Never matched to each other by inference.
- Group membership is LID-addressed, address book largely phone-addressed → `pn_lid_map` bridges them using WhatsApp's OWN mapping.

## Scale forces policy

Live account: 8,384 contacts · 817 groups · 35,298 unique participants · 54,245 memberships · largest group 1,146.

Group membership ≠ relationship. Participant policy: `contacts` / `contacts_and_messaged` (default) / `all`, per-group override. 998 vs 35,298 People — difference between reviewable and useless. Community records full size next to what policy proposed ("52 of 58 known to you").

## Residency

Raw capture + phone numbers **Local Plane only**. `local_people.phones` is local-only (unlike `emails`, which dual-writes). Bulk import → `local_person_lists` roster, **out of the relationship graph**. Cloud canonical needs an explicit separate promote.

## v2 — sending

`decideSend`: **approve per recipient, then trusted**. Grant bound to exact message body → standing trust ≠ blank cheque for later text. Revocation beats any live approval. Malformed/empty = refused, never an approval prompt (don't train click-through).

## Commons

**Withheld**, like `relationship`. Private contact graph out of a third-party session ≠ generalized installable capability.

## ToS

Unofficial automation of personal WhatsApp violates WhatsApp Terms, any library. Reading own contacts = mildest end. Risk accepted knowingly, not mitigated away.
