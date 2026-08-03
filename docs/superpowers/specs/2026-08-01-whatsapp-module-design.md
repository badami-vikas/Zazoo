# WhatsApp Module — design (v1 read-only)

Date: 2026-08-01
Status: approved (user, 2026-08-01)
Tier: C (new built-in Module, cross-plane, external session, personal data)

## Purpose

Add a `whatsapp` built-in Module. Clicking it in the left nav lands on a live WhatsApp Web
surface running the user's own linked-device session. A sibling **Tools** Page hosts an
extensible Tool list; v1 ships one Tool, **Contact Extractor**, which turns WhatsApp
individual contacts into People proposals and selected WhatsApp groups into Community
proposals with participant People and membership Relations.

Primary constraint from the user: **minimal account risk**. Most of the user's clients use
personal (not Business) WhatsApp numbers, so the official WhatsApp Business Cloud API is
not applicable and enforcement against a personal number is the dominant risk to manage.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Engine | `@wppconnect/wa-js` (Apache-2.0, v4.5.x) injected into a real WhatsApp Web page | Runs WhatsApp's own client code rather than a reimplemented protocol (Baileys/whatsmeow); no Chromium to bundle (whatsapp-web.js); actively maintained; exposes the exact read functions needed |
| Surface | Borderless Tauri child webview window tracked to the Module Page's content rect | Reads as embedded, works on stable Tauri (no `unstable` feature flag across the whole desktop shell), page holds zero Tauri permissions |
| Extractor v1 scope | Both individual contacts and user-selected groups | User selects which groups; no blind full sweep |
| Residency | Local-only capture, opt-in promote | Raw capture and phone numbers stay in the Local Plane; canonical Records carry name + local identity reference |
| Write capability | Deferred to v2 | v1 is read-only behind a fixed op allowlist |
| Write approval gate (v2) | Approve per recipient, then trusted for that recipient | First outbound message to a Person requires explicit human approval; later messages to that same Person may be sent by an approved Agent |

### Rejected alternatives

- **whatsapp-web.js + Puppeteer/Chromium sidecar.** Cleanest typed API, but bundles a
  second browser (~200MB), adds a supervised process, and puts the WhatsApp UI in a
  separate Chrome window rather than inside Bridge.
- **Baileys / whatsmeow (protocol clients).** Lightest, but reimplement the multi-device
  protocol — higher enforcement exposure on a personal number — and render no WhatsApp UI
  at all, which defeats the Module's primary surface.
- **Bridge-authored DOM scraping, no third-party library.** Zero dependency but brittle
  against every WhatsApp UI change, and re-solves what wa-js already maintains.
- **Tauri `unstable` multi-webview (`add_child`).** Visually cleanest embed, but forces the
  `unstable` feature flag on the entire desktop shell — a stability cost paid by every
  surface, not just this Module.

## Plane split

The WhatsApp session exists **only on desktop (Tauri)**. `web.whatsapp.com` refuses framing
and no browser page can inject script into another origin, so the web and mobile clients
cannot host the session at all. They show an honest "Available on Bridge desktop" state
plus read-only views of Records already captured by a desktop run.

## Components

### 1. `platform/modules/whatsapp/` — pure module package

Mirrors `modules/dealpilot` and `modules/jobpilot`. No Tauri, no network, no DOM: every
file here is unit-testable in isolation.

- `types.ts` — WhatsApp contact, group, and participant value types; run and result types.
- `normalize.ts` — phone normalization to E.164, display-name vs push-name precedence,
  dedupe key derivation.
- `extract.ts` — pure mapping from a raw extraction payload to intake proposals
  (People, Communities, membership Relations, `possible_duplicate` Signals).
- `tools.ts` — the Tool registry the Tools Page renders. v1 has one entry.
- `manifest.ts` — capability manifest (Pages, extract Skill, WhatsApp Agent, Tools).

### 2. `apps/desktop/src-tauri/src/whatsapp_webview.rs` — contained session webview

Modelled directly on `research_webview.rs`, which already establishes the containment
pattern for adversarial external content.

Shared with the research reader:
- Window label deliberately absent from `capabilities/default.json`, so the page holds no
  Tauri permissions; as an external origin, Tauri v2 never injects the IPC object at all.
- Its own minimal init script — never the main window's script, which carries the sidecar
  token.
- `on_navigation` allows only WhatsApp origins; every other scheme and target is refused.
- Extraction is outbound-only: the injected script serialises its result and navigates to
  a `bridge-wa:` URL, which the navigation handler decodes and cancels.

Deliberately different from the research reader:
- **Persistent** data store, so the linked-device session survives app restarts. The
  research reader is ephemeral by design; this one must not be.
- The wa-js bundle is **vendored into the repo and SHA-256 pinned**, verified before
  injection. Fetching it from a CDN at runtime would mean an unpinned third-party script
  executing inside the user's live WhatsApp session.

Commands: `whatsapp_open`, `whatsapp_position`, `whatsapp_hide`, `whatsapp_status`
(authentication/link state), and `whatsapp_extract_start` + `whatsapp_extract_poll`.
The start/poll split is required by the known WKWebView failure where a command answering
after ~60s aborts the app (see `tauriInvokeJob`).

**Read-only op allowlist.** `whatsapp_extract_start` accepts only a fixed set of named ops
— `list_contacts`, `list_groups`, `group_participants` — each mapped Rust-side to a
specific wa-js call. The web app can never pass arbitrary JavaScript into the page. This is
the mechanism that makes v1 genuinely read-only, and it makes v2 writes a deliberate,
separately reviewed change rather than a configuration flip.

### 3. Web surface — `apps/web/src/app/pages/WhatsAppPage.tsx`

Two sibling Pages per UI page-anatomy canon:

- **Chats** — the live WhatsApp Web surface. Renders a placeholder rect; a ResizeObserver
  plus scroll, route-change, and window-blur listeners feed that rect to
  `whatsapp_position`, so the child window tracks the content area and hides as soon as the
  user navigates away.
- **Tools** — the Tool list. Contact Extractor opens a run panel: choose *My contacts* or
  *Groups*, select which groups, Run, review the results table, then stage proposals.

Outside the desktop shell both Pages render the honest unavailable state.

### 4. Capture and commit

1. A run's raw payload is written to the Local Plane `BodyStore` under
   `whatsapp:capture:<runId>`. It never crosses the gate to cloud canonical.
2. `extract.ts` maps the payload to proposals using the same matching rules as Google
   intake: exactly one match links; several matches file a `possible_duplicate` Signal and
   never auto-merge; no match proposes a new Person.
3. Proposals enter the existing draft-then-approve Approvals path. Nothing is committed by
   the run itself — capture is not commit.
4. On approval: Person and Community Records materialize; a group becomes a Community with
   its participants as People and membership as Relations. **Phone numbers remain
   local-only**; the canonical Record carries the name and a local identity reference.
   Promoting a number to canonical storage is a separate explicit action, not built in v1.

### 5. Registration

Append the manifest to `BUILT_IN_MODULES` in `platform/modules/manifests/src/index.ts` —
that alone seeds the Module, places it in the left nav, and provides manifest-driven Module
Detail. Add the routes and the `BUILT_IN_SOURCE_REFS` entry.

Excluded from `COMMONS_BUILT_IN_MODULES`, for the same reason `relationship` is excluded:
private-contact read combined with an external personal session is not a publishable
generalized capability.

## Risk posture (v1)

- Read-only, enforced by the Rust-side op allowlist rather than by convention.
- User-initiated runs only. No Automations, no scheduled sweeps, no Agent holding the
  extract Skill outside an explicit user action.
- One extraction in flight at a time, sequential — no parallel request bursts against
  WhatsApp.
- wa-js vendored and hash-pinned; no runtime third-party script fetch.

## Honest risk statement

Unofficial automation of a personal WhatsApp account violates WhatsApp's Terms of Service
regardless of which library is used. Reading one's own contact list is the mildest end of
that spectrum, and wa-js runs WhatsApp's own client code rather than a reimplemented
protocol — which is why it is the lowest-risk option available here — but the risk to the
account is not zero. This is accepted knowingly by the user, not mitigated away.

## Primary unknown

Whether WhatsApp Web functions at all inside Tauri's macOS WKWebView: user-agent gating,
IndexedDB/storage persistence, and whether a linked-device QR session survives an app
restart. This is unverified and is the single assumption the whole top layer rests on.

The implementation therefore begins with a throwaway spike that answers exactly this before
any Module code is written. If the spike fails, the fallback is the Chromium-sidecar route;
the module package and the intake path survive that change unaltered, only the session and
extraction layer is replaced.

## Out of scope for v1

Sending messages, group-membership writes, message-history capture, and Automations. v2
writes will use the per-recipient-then-trusted approval gate recorded above.

## Testing

- Unit tests in the module package: phone normalization, dedupe keys, group → Community
  mapping, participant → Person mapping, ambiguous-match Signal generation.
- Manifest test, matching the existing per-module manifest tests.
- Wiring test asserting the Module seeds and appears as an available nav Module.
- The webview layer is verified live (QR link, session persistence across restart, one
  extraction run) and reported honestly — never asserted from code inspection alone.

## Governance artifacts

- ADR appended to `docs/raw/decisions-log.md` (engine choice, containment model,
  residency, read-only allowlist).
- TASK row in `docs/TASKS.md` with an independent exit test.
- `docs/APPROVALS.md` row recording the user's explicit approval as APPLIED.
