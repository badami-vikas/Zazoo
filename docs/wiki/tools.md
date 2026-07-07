# Tools (wiki)

full: [../raw/tools-internalization.md](../raw/tools-internalization.md) · plan: [../raw/tool-standardization-plan.md](../raw/tool-standardization-plan.md)

**Primitive mapping** ([ontology](ontology.md), 2026-07-07): "tool"/`ToolManifest` here = implementation/package surface; the user-facing primitive = **Workspace**. Internal tools ≈ Skill/Integration capabilities; external tools ≈ Workspace surfaces. Page keeps code vocab.

## Standardization plan (LOCKED 2026-07-03, ADR-006)
- **One monorepo.** `platform/` = single home. apps/web + apps/api + packages (tool-kit ·
  tables · sourcing · dedupe · facts · llm · extraction) + tools/*. No new app shells EVER.
- **Internal tool = capability** (headless, no nav): people-sourcing · company-sourcing ·
  enrichment · recorder · extraction. **External tool = surface** (UI, registry entry):
  Helpdesk · DealPilot · JobPilot · Card Scanner · Camera · Calendar · Conference. External
  manifest declares `composes: [internal ids]` — Conference composes recorder, gets it free.
- **Recon splits** → people-sourcing + company-sourcing internal tools. staging.jsonl parallel
  governance DIES; everything through ONE intake seam → quarantine → proposal → Approvals.
  hni folds into people-sourcing. Helpdesk migrates from prototype pages → tools/helpdesk
  (why no Tools/helpdesk folder existed: predates tool model).
- **Integrations platform-level ONLY.** Tools never own OAuth. Capability grants via Authority.
  DealPilot CIM-request + JobPilot Gmail-router use the SAME google integration thru the gate.
- **JobPilot/DealPilot specs** = requirement docs in raw/ (verbatim). Their standalone stacks
  REJECTED: Hatchet/BullMQ not Trigger.dev · local plane not SQLite · pipeline not bespoke
  review queues · Python = sidecars behind ports only (Docling, Resume-Matcher scorers).
- **Order:** Phase 0 hygiene → 1 extract engine (tables/dedupe/facts/sourcing pkgs) →
  2 internal tools → 3 **DealPilot FIRST** → 4 JobPilot + Helpdesk migration → 5 absorb
  prototype, delete standalone apps.
- **DoD any tool work:** manifest first · one intake seam · compose don't copy · no new shells ·
  no tool OAuth · env-bound URLs fail-loud · conformance test + wiki + log.

**Progress (2026-07-04):** Phase 0-2 complete, Phase 3 (DealPilot anchor) shipped + P0 connectors real.
- Shipped packages: `tool-kit` (7 tests) · `tables` (9 tests) · `dedupe` (7 tests, bigram Dice
  match scoring + strong/moderate/flag tiers) · `facts` (4 tests, append-only + living-profile) ·
  `sourcing` (5 tests, tiered waterfall + budget ledger + 2 proof connectors: API client,
  email-alert parser).
- Shipped internal tools: `tools/people-sourcing` + `tools/company-sourcing` (3+4 tests) —
  manifests validate against tool-kit, compose sourcing+dedupe+facts, domain treated as company
  business key (exact-match strong tier, same role email plays for people).
- Whole-monorepo `turbo run typecheck test build --force`: 36/36 tasks, 0 cached.
- Two real bugs caught by actually running tests (not trusting green build): dedupe's trigram
  scorer was too strict for short name typos (switched to bigram Dice); a `<=` vs `<` sentinel
  bug silently dropped the only candidate in a blocking pool.
- **Recorder extracted** (2026-07-04): `tools/recorder` (internal) wraps the existing
  Tools/recorder FastAPI backend as a typed HTTP sidecar port (`RecorderPort`:
  record/pasteTranscript/transcribe/summarize) — Python code untouched, base URL is a required
  env-bound constructor arg (fails loud, no localhost default). 3 tests.
- **DealPilot anchor** (Phase 3): `tools/dealpilot` — manifest composes company-sourcing +
  people-sourcing + recorder; owns ThesisFit scoring, deal dedup via matchCompany, deals
  kanban table. 6 tests.
- **JobPilot anchor** (2026-07-04, Phase 4): `tools/jobpilot` — manifest composes
  company-sourcing + people-sourcing (llm/calendar/google not live yet, not invented). Owns:
  `scoreJobFit` (rule-based green/yellow/red card scoring), `evaluateTailoredMaterials`
  (deterministic fabrication guard on resume change_log — evidence-in-master OR jd_added on a
  non-protected field), `processJobCandidate` (sources → job-posting dedupe via own
  company|title|location key on `@bridge/dedupe` → `alreadyAppliedToCompany` guard via
  company-sourcing's `matchCompany`, compose not copy), Greenhouse/Ashby/Lever Tier-1 connector
  stubs, card-feed (gallery/flag) + tracker (kanban/stage) table views, `transition` (the sole
  applications.status state-machine helper, validates + logs stage_events per the arch doc's
  transition graph), `createAnswerBank` (normalize→exact→fuzzy on `@bridge/dedupe`'s
  trigramSimilarity; SSN/payment questions unconditionally raise `NeedsHuman`), `buildCandidateProfile`
  (M1 onboarding: keyword-presence skill/category heuristic, NOT a PDF/LLM parser — closes the
  onboarding→scoring seam), `routeEmail` (M7 Gmail Smart Router: confidence-bucket routing policy
  only — auto_linked>=95/review 50-94/orphan<50 — classifier itself injected same as connectors'
  fetcher; downgrades to review if the proposed stage isn't a legal `transition()`), `resolveEntryTier`
  + `mapAnswersToForm` + `nextDispatchAction` + `assertApprovedForSubmit` (M6 apply-waterfall
  decisions: big-3 ATS→Tier1 else Tier2; form-field→answer-bank mapping collecting unresolved
  required fields; S7 failure-taxonomy router — CAPTCHA/LOGIN_ISSUE always park immediately,
  FAILED escalates tier-by-tier; "no submit without approved eval" as a callable gate),
  `createPacingGate` (S7 daily + per-ATS-domain apply caps, resets per day). 46 tests. Not done:
  real PDF/LLM resume parsing, writer/browser-apply agents, PDF rendering, real ATS HTTP/Playwright
  execution, real Gmail API, the tier-escalation loop itself, persistence for any of the above.
- **JobPilot + DealPilot prototype UI** (2026-07-04, `Design Bridge AI Interface (Copy)`):
  standardized on shared Notion-style components — `NotionCard`/`CardGrid` (compact, fixed
  `HelpdeskCard`'s "too broad and long" grid too), `FlagIcon` (literal colored flag, tooltip-only
  explanation, no inline prose), `KanbanBoard` + `ListView` (Tracker = kanban, new list view),
  `ToolPageHeader` (profile+settings gated by `STANDALONE = !API_ENABLED`). `AgentPanel` now says
  "JobPilot AI"/"DealPilot AI" per-route. `data/jobpilot.ts` + `data/dealpilot.ts` port the
  platform packages' scoring/state-machine/evaluator/dispatcher logic into the reactive
  localStorage-store pattern. Browser-verified end to end.
- **Platform UI standardization Phase 1+2** (2026-07-04, same prototype): Boundaries replaces
  Permissions everywhere (condensed tooltip, not a 3-sentence banner); Apps replaces Integrations;
  one `StandardToolbar` + `ToolPageHeader` + `ListBar` layout (title → Lists → toolbar) across
  JobPilot/DealPilot/Helpdesk/PublicHelpdesk; flags ARE the action (no card buttons), universal
  green/yellow/red meaning platform-wide; always-collapsed icon-rail Sidebar with labels;
  standalone JobPilot shell at `/standalone/jobpilot`. Phase 2: `data/lists.ts` (generic scoped
  list store) + `ListBar` give every tool user-creatable lists with a per-list AI instruction and
  multi-select **merge** (stamps each row with its origin list as a category); `ConnectAppFlow`
  is the standardized API-first/waterfall (scrape/bot/Claude-in-browser) Apps connect wizard,
  wired to `IntegrationDetail`'s Configure button. All browser-verified end to end.
- **Not done**: actual recon/hni data migration into people/company-sourcing (still separate
  apps, frozen read-only per plan §4 is the NEXT step, not yet executed), the recorder's actual
  frontend UI migration, Phase 5 (prototype absorption).
- **Recorder extracted**: `tools/recorder` (internal) wraps the existing Tools/recorder FastAPI
  backend as a typed HTTP sidecar port (`RecorderPort`: record/pasteTranscript/transcribe/
  summarize) — Python code untouched, base URL is a required env-bound constructor arg (fails
  loud, no localhost default). 3 tests.
- **Phase 3 — DealPilot anchor**: `tools/dealpilot` (external, `/dealpilot` nav, composes
  company-sourcing + people-sourcing + recorder) — `ThesisFit` v1 scoring, S1-S4 pipeline
  (waterfall → facts → dedupe compose → score), `dealsTableSpec` kanban view.
- **DealPilot P0 connectors made real (2026-07-04)**: BizBuySell = real regex parser
  (`parseBizBuySellAlert`) + `createGmailFetchMessages` composing the ONE governed
  `@bridge/integrations-google` gateway (no tool-owned OAuth). BusinessBroker.net = real
  `normalizeBusinessBrokerRow` only — its `robots.txt` Disallows `/listings/` + all query-string
  URLs (its search endpoint) and no feed exists, so live fetch is a blocked seam, not built
  (see [BUGS.md](../BUGS.md)). 19/19 dealpilot tests. Prototype `/dealpilot`
  kanban page shipped (dummy_ data, honest connector-status strip).
- **Generic intake seam (2026-07-04)**: `@bridge/tool-kit` `createToolSourceSkill` /
  `ToolIntakeMaterializer` / `ToolCaptureStore` — quarantine → pipeline `external:fetch`
  proposal → human-commit, reusable by any manifest tool (Recon migration still pending).
  DealPilot wired first (`apps/api` `dealpilot.source`/`commit`/`list`). 9/9 tool-kit tests.
- Whole-monorepo `turbo run typecheck test`: 41/41 tasks green.
- Two real bugs caught earlier by actually running tests (not trusting green build): dedupe's
  trigram scorer was too strict for short name typos (switched to bigram Dice); a `<=` vs `<`
  sentinel bug silently dropped the only candidate in a blocking pool.
- **Not done**: actual recon/hni data migration into people/company-sourcing (still separate
  apps, frozen read-only per plan §4), the recorder's frontend UI migration, DealPilot's own
  UI surface (kanban/feed/detail — connectors + engine only so far), Phase 4+ (JobPilot).

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
