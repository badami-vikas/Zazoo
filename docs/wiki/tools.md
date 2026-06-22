# Tools (wiki)

full: [../raw/tools-internalization.md](../raw/tools-internalization.md)

**Call (2026-06-03):** Tool model = internalize external repos + two run modes + gated intake. Reuses EXISTING primitives, ZERO new subsystem. Triggered by 2 reference repos (`Tools/card-scanner`, `Tools/recorder`).

## Locked (user-confirmed)
- **Internalize external repos** = "plug-and-play": adopt GitHub repo → **internal MODIFIED COPY** (not live dep; = air-gap/vendored stance). Keep front+back pathway **broad/flexible** — contract at edges only.
- **Two run modes, one codebase**: **standalone/shareable-link** (friends use, no Bridge account) + **account-bound** (signed-in → output → graph).
- **Gated intake**: standalone/friend captures **quarantined** → enter platform ONLY on **user approval**. Capture ≠ commit.
- **Recorder = single-party self-capture** (own meeting; private relationship tier; consent still gates sharing OUT).
- **Capture plane = local models default** (Ollama vision + local Whisper); cloud = explicit egress grant.

## Maps to existing primitives (no new subsystem)
- Internal copy = **versioning** lineage (upstream = v0; diffable/rollbackable).
- Gated intake = **Universal Action Pipeline** at ingestion edge (capture = `pending_review` proposal → approve → commit + ledger).
- Shared-link runtime = **cloud plane** (public internet); pulling captures home = inbound sourcing thru the gate (public-scope, untrusted, reviewed).
- Output→entity = **typed output contract** (same self-heal-contract mechanism as rituals).
- Tool model/API calls = **capability broker** (never direct).
- Local-default capture = **two-plane gate**.

## Net-new surface: Tool manifest (edges only)
`id/name/version/source_repo/internalized_at · run_modes[] · surfaces{frontend,backend} (flexible) · model_bindings[{use:vision|transcription|llm, plane_default:local}] · capabilities[{resourceType,action,dataScope,egress}] · output_contract[{from→to: Person|Memory|Touchpoint|Signal|Initiative}] · intake_policy{quarantine:true, commit_via:pipeline_proposal}`. Internalize = rebind 3 edges: model→ModelProvider · persistence→quarantine store · output→contract. UI/logic stays as-is.

## Intake flow
`capture (standalone/friend/in-app) → quarantine (cloud, public-scope, provenance-tagged) → "Adopt" → Pipeline (Authority→Policy→map via contract→pending_review) → approve|edit|veto → commit graph + ledger(provenance: tool+ver+source)`. Friend capture = third-party-sourced → never silent merge. In-app trivial = auto-mode eligible; external = forced review.

## Reference mappings
- **card-scanner** → Person-capture: rebind vision switch→ModelProvider(local); drop dead `parse-card.ts` + vestigial anthropic SDK; contract 8 fields → **Person**(canonical) + **Touchpoint**("met"); keep few-shot feedback loop. **Link-version intake UX (confirmed):** captures = **download** | **"Add to Bridge"** → lands in Bridge **Tools section** as a pending list → per-item **Add** btn = the Pipeline proposal → review → commit+ledger. (Generalizes: link-tool = download | Add-to-Bridge → Tools pending list → per-item Add = commit.)
- **recorder** → Conversation→Memory: **BUILT (2026-06-03)** — PRIVATE + account-bound (no anon link; private∩egress=none). Manifest + `bridge.ts` (`conversation.v1` envelope, data_scope private) + Add-to-Bridge in SummaryPanel; Bridge side: contract-aware captures seam + ToolDetail panel + Recorder tool; **Add** → memory:write proposal → Approvals → **Approve → Initiative + Touchpoints** (next_steps{text,owner,due} materialize as the touchpoint tree; summary→Initiative goal since Memory surface = P3). RLS: authenticated may insert private quarantined (anon = public-only). **Follow-ups**: recorder BACKEND still service_role (rebind behind RLS/local-first seam — Python, deferred); needs an authenticated Bridge session to insert private from a separate origin; Memory entity surface = P3.

## Google integration (Gmail + Calendar) — BUILT 2026-06-20
First real account-bound integration. Same gated-intake model, but native (platform), not a link-tool. full: code in `platform/packages/{local,integrations-google}` + `apps/api`.
- **Two new packages**: `@bridge/local` = LOCAL plane (pglite + in-memory adapters; ports `SecretStore`/`BodyStore`/`LocalGraphStore`). `@bridge/integrations-google` = egress adapter (`googleapis`) + skills + IntakeService + EgressExecutor + GoogleService. `@bridge/db` += `CanonicalIdentityStore` (cloud dual-write target).
- **Residency FIXED for this slice**: OAuth tokens + raw Gmail/Calendar bodies + derived Touchpoints/Memories/Signals → LOCAL pglite, NEVER Supabase. Ledger stays local (in-mem/local), so private proposal content never crosses. Only counterparty PUBLIC identity dual-written to canonical.
- **OAuth**: `googleapis` OAuth2, scopes gmail.readonly + gmail.drafts.create + calendar.events, offline+consent → refresh token. Tokens in `SecretStore` (local). Real `GoogleApiGateway` when `GOOGLE_CLIENT_ID/SECRET` set; else `MissingGoogleGatewayFactory` fails closed (NO fake/dummy — purged 2026-06-22; platform sources only real data).
- **READ (source→propose, by approval)**: egress agent (cloud) sources via `external:fetch` thru gate; user's Sync click approves the crossing; bodies cached LOCAL. Per item, local intake agent PROPOSES Touchpoint(+Memory) / Signal `pending_review`. Match by email: 1 hit → link; >1 → possible_duplicate **Signal, never auto-link**; 0 → new counterparty (identity dual-write). Approve → IntakeMaterializer commits LOCAL + dual-writes identity. Idempotent via `external_records`.
- **WRITE (draft→approve→send)**: compose skills make DRAFT only (no send at propose-time — skill runs pre-gate). Agent `external:send` = agent-floor DENY (can't even draft as egress). Human proposes `external:send` (cloud) → `require_approval` → approve ≥L2 → EgressExecutor calls gateway, audits crossing + `external_records`. Idempotent, never double-send.
- **Prototype wired**: `IntegrationDetail` id=`google` → `GoogleIntegrationPanel` (real connect/disconnect/sync/propose-send via `data/api.ts`, default-off `VITE_API_URL`). Mock integrations keep old UI. Sourced proposals + send drafts land in existing Approvals.
- **Pipeline ordering gotcha**: `skill.run()` fires at `propose()` (pre-approval); `#commit()` only emits event. ⇒ egress skills draft-only; real send runs post-approval in EgressExecutor off the approved ledger row.
- **Proven**: core conformance suite thru real pipeline+gate (read→approve+dual-write, ambiguous→Signal, draft→send floor-block, local-can't-egress, agent-never-approves) + `@bridge/local` pglite round-trip. (Google fake-gateway integration test removed in the 2026-06-22 dummy purge — live-only now.)

- **camera** → Media-capture: **BUILT (2026-06-20)**. Built-in Tool, photo + video. Photo = `getUserMedia` + `canvas.toBlob`; video = `MediaRecorder`. Compress photos `browser-image-compression`; OCR local `tesseract.js` (no API key). Capture = **PRIVATE relationship data**, dataScope `private` → `private ∩ egress = none` → blob structurally cannot cross gate. Blob + metadata stored **LOCAL plane ONLY** via new **`LocalMediaStore`** port (see [architecture](architecture.md)) — never Supabase Storage, never cloud bucket. Capture ≠ commit: lands `pending` (quarantine) in the Camera panel + browsable in Resources. **Add to Bridge** → `media.v1` proposal carrying ONLY `local_media_id` + facts (caption/OCR/optional link), NO blob → review → approve → append-only ledger + a **Touchpoint** ("Captured a photo/video"); media row `pending→committed` w/ `ledger_id`. Optional link Person/Memory/Touchpoint inside proposal only; **uncertain match NEVER auto-linked → `possible_link` Signal**. `stageCapture` skill maps envelope→Touchpoint|Signal. Two adapters one port: platform `PgliteMediaStore` (bytea, tested) + browser IndexedDB (demo). Output contract `media.v1`; intake_policy{quarantine, commit_via:pipeline_proposal, scope:private, account_bound_only}. Run modes = account_bound (standalone link deferred). DEFER: cloud vision egress, face detect, video transcription, E2EE (P6).

## Schema deltas (v2)
Tools registry += source_repo · internalized_copy_ref · version · run_modes[] · output_contract · capabilities[] · intake_policy. + **quarantine store** (staging, cloud/public-scope, provenance, inert till adopted). Reuses pipeline/ledger/contracts/versions/gate.

## Open / held
- ~~card-scanner note truncated~~ RESOLVED: link-version = download | Add-to-Bridge → Tools pending list → per-item Add = commit.
- **Sequencing** (still open): build card-scanner as pilot internalized Tool now (exercises whole adapter contract small), or Initiatives first? — user call.
- Shared-link hosting/minting/quarantine-retention = design at build.
