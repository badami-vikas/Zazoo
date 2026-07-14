---
title: OSS Code-Level Diligence — Learning / JobPilot / Calendar / Builder stacks
type: raw
doc_kind: audit
status: active
companions: [learning-agent-roadmap-2026-07.md, jobpilot-module-plan-2026-07.md, calendar-module-plan-2026-07.md, builder-agent-roadmap-2026-07.md, clean-room-capability-research-protocol-2026-07.md]
related_wiki: ../wiki/index.md
updated: 2026-07-13
tags: [oss, diligence, licenses, mem0, firecrawl, stagehand, resume-matcher, career-ops, ical, react-big-calendar, appsmith, dyad, bolt-diy]
---

# OSS code-level diligence (2026-07-13)

Method: shallow clones analyzed at source level (not READMEs) by 4 parallel subagents — file-verified licenses (incl. per-directory sweeps for mixed licensing), does-the-claimed-thing-exist checks against the roadmap source maps, exact file paths for every pattern Bridge adopts. Closes the gap flagged in ADR-050/051 (earlier diligence subagents hit session limits). Commits pinned per repo below; re-verify at vendor-pin time.

Headline: **no vapor** — everything the roadmaps lean on exists in code, several assets are stronger than assumed. Corrections found: 2 roadmap overstatements (career-ops rubric/batch = prompts not code; JobFunnel key_id ≠ composite key), 2 verdict changes (firecrawl: prefer pattern-port over engine adoption; cal.diy: MIT verified, drift suspicion cleared), 2 compliance traps (mem0 telemetry + cloud defaults).

# 1. Learning stack (LA0 / LA3)

## 1.1 mem0ai/mem0 — ADOPT behind MemoryPort (LA0). Pinned `1783674` (2026-07-11).

```yaml
license: Apache-2.0 UNIFORM — root + every subdir LICENSE checked (server/, mem0-ts/, integrations/*, skills/*); no mixed dirs
wrap_targets:
  - class Memory / AsyncMemory (mem0/memory/main.py:450, :2112)
  - add(): main.py:723 — returns {results:[{id,memory,event:ADD|UPDATE|DELETE}]}; infer=False stores verbatim (:838)
  - search(): :1337 · get/get_all/update/delete/delete_all/history: :1166/:1213/:1773/:1825/:1846/:1888
  - scoping: _build_filters_and_metadata (:287) — user_id/agent_id/run_id (>=1 required) + actor_id; maps to Bridge scope
local_proof:
  - pgvector supported: vector_stores/pgvector.py:142 — CREATE EXTENSION vector, HNSW, GIN on payload JSONB; metadata natively filterable → Bridge taint tiers queryable (filters={"taint_tier":...})
  - llms/ollama.py + embeddings/ollama.py exist; fully-local = explicit config {llm:ollama, embedder:ollama, vector_store:pgvector}
  - history audit trail: SQLite always (memory/storage.py, ~/.mem0/history.db)
extraction_prompt: configs/prompts.py:468 ADDITIVE_EXTRACTION_PROMPT (+:1016 user prompt, :947 agent suffix); flow _add_to_vector_store (:837) — one LLM call, UUID→int-index anti-hallucination (:891)
provenance: NO taint/source-trust concept in mem0 — Bridge stamps provenance{source_type,taint_tier,captured_at,plane} into metadata at add(); quarantine + no-tools-on-taint policy is Bridge-layer
ignore: server/ + openmemory/ (their REST service/UI), mem0/client/ (hosted Platform SDK), timestamp param (raises "Not supported in OSS")
traps:
  - TELEMETRY ON BY DEFAULT → PostHog us.i.posthog.com (memory/telemetry.py:14, MEM0_TELEMETRY default "True") — MUST set False for local-plane/no-egress
  - cloud defaults: llm=openai, embedder=openai, vector_store=qdrant — zero-config path phones OpenAI; Bridge must always pass explicit local config
  - main.py is a 163KB monolith — wrap, don't copy
```

## 1.2 mendableai/firecrawl — VERDICT CHANGED: prefer pattern-port, not engine adoption (LA3). Pinned `af6d47f` (2026-07-11).

```yaml
license: MIXED — root/apps/api = AGPL-3.0; SDKs MIT (python-sdk, js-sdk, ruby, elixir, ingestion-ui — per-dir LICENSE verified)
trap: apps/api/package.json says "ISC" — stale field; governing license is root AGPL. Never trust the package.json field
self_host_footprint: GREW — api + playwright-service + redis + rabbitmq + nuq-postgres + foundationdb (docker-compose.yaml); "Redis+Playwright" assumption stale
ssrf: GENUINE + wired — apps/api/src/scraper/scrapeURL/engines/utils/safeFetch.ts: ipaddr.js .range()!=="unicast" block on CONNECTED socket.remoteAddress (defeats DNS rebinding, re-fires per redirect hop); wired into fetch engine/downloadFile/search/webhooks
ssrf_gaps: domain blocklist disabled in self-host (blocklist.ts:107 needs USE_DB_AUTHENTICATION); Playwright rendering path bypasses safeFetch — separate egress constraint needed; maxRedirections 5000 (cap lower)
verdict_order:
  1: PORT THE PATTERN — safeFetch.ts is ~95 lines, directly-portable reference for Bridge's own SSRF client (roadmap requires Bridge owns this anyway) + drive Playwright directly. Avoids AGPL + 5-service ops burden. ← preferred for LA3
  2: MIT SDK → Bridge-hosted AGPL self-host as contained separate service (only if crawl/extract breadth needed)
  3: Firecrawl Cloud via MIT SDK — cloud-plane research only (violates local-plane stance otherwise)
```

## 1.3 browserbase/stagehand — ADOPT behind port, LOCAL mode, read-only subset (LA3). Pinned `b07de53` (2026-07-10).

```yaml
license: MIT clean (root + packages/core + packages/cli); playwright-core + zod peer deps
architecture: class V3 (packages/core/lib/v3/v3.ts:154) — act():1230 / extract():1377 / observe():1479
local_proof: env:"LOCAL" needs NO Browserbase creds (guard only inside BROWSERBASE branch, v3.ts:1035-1054); local Chrome via chrome-launcher (launch/local.ts); LLM in-process via lib/v3/llm/LLMProvider.ts (Anthropic/OpenAI/Google/Groq/Cerebras clients) — inference is yours
schema_enforcement: REAL — extract<T extends StagehandZodSchema>; zodCompat.ts toJsonSchema constrains model, output re-validated through Zod (handlers/extractHandler.ts:143) → pin extractions to Bridge CompetitorBrief/ResearchBrief schemas at the port
gotchas:
  - NO SSRF guard of its own — drives real browser to arbitrary URLs; Bridge's SSRF/allowlist + governed-session wrapper sits in front
  - act() + CUA agent handlers TAKE ACTIONS — for neverExecutes Learning Agent expose ONLY extract/observe through the port
  - bundles many @ai-sdk/* providers — trim to ModelProvider set
```

# 2. JobPilot stack (JP1–JP3)

## 2.1 srbhr/Resume-Matcher — claims VERIFIED, stronger than assumed (JP3)

```yaml
license: Apache-2.0 file-verified; reusable logic NOT coupled to FastAPI/Next (improver/ats/refiner/scorers/judge import only app.llm/app.prompts/app.schemas — grep-verified)
truthfulness_gate_exists: YES —
  - verify_skill_target_plan: apps/backend/app/services/improver.py:754 (called routers/resumes.py:908) — classifies skills existing|jd_added|supported_by_resume, else REJECTED unsupported
  - deeper diff gate: generate_resume_diffs → apply_diffs → verify_diff_result (improver.py) — _ALLOWED_PATH_PATTERNS (:80, only descriptions/summary/additional editable), _BLOCKED_FIELD_NAMES (:101 company/institution/title/degree/years/name/… = Bridge PROTECTED_FIELDS ALREADY IMPLEMENTED), verify_diff_result (:430 zero-LLM: identity unchanged, section counts, 1.8x word cap, invented-metric regex \d+%|\d+x|\$\d+)
  - prompt-injection sanitization on JD input (_sanitize_user_input)
prompts: app/prompts/templates.py (CRITICAL_TRUTHFULNESS_RULES_TEMPLATE :203, 9 NEVER-VIOLATE rules, nudge/keywords/full intensities :222) + refinement.py (VALIDATION_POLISH_PROMPT, AI-phrase blacklist)
evaluator_exists: YES — 5 deterministic scorers tests/evals/scorers.py (sections_preserved, no_fabricated_employers, jd_keywords_present, is_valid_resume, personal_info_unchanged) + LLM judge e2e_monitor/judge.py (RELEVANCE/TRUTHFULNESS/FORMATTING 1-5, JD_KEYWORD_TOLERANCE=0.20) + ats.py composite (keyword 0.55 weighted) + golden cases tests/evals/golden/
port_notes:
  - ResumeData is THEIR schema, NOT JSON Resume — allow/block path regexes hardcoded to it; rewrite paths when mapping to jsonresume (work/skills)
  - upstream ACCEPTS jd_added skills (surfaced in diff preview) — Bridge tightens to PROTECTED_FIELDS-never-jd_added on port; a policy delta, not an inherited guarantee
  - LLM layer = LiteLLM multi-provider (ollama/anthropic/…) → maps onto ModelProvider cleanly
```

## 2.2 santifer/career-ops — URL RESOLVED; providers verified; rubric/batch downgraded to design-reference (JP2)

```yaml
url: https://github.com/santifer/career-ops   # was "(per Platforms CSV)" — found in Tools/Job/Platforms/opensource_job_tools_master.csv:19, NOT job_scanning_apis_repos.csv
license: MIT file-verified (+TRADEMARK.md/LEGAL_DISCLAIMER.md — name-only restrictions, code unaffected)
code_asset: providers/ — 54 zero-auth ATS/aggregator clients (MORE than claimed ~40): greenhouse/lever/ashby/workable/smartrecruiters/workday/recruitee/personio/teamtailor/… + arbeitnow/remoteok/remotive/themuse/himalayas/weworkremotely/hackernews + enterprise (amazon/ibm/…)
interface: uniform {id, detect?(entry), fetch(entry,ctx)→Job[]} (providers/_types.js); Job.url = dedup key + trustScore/trustLevel; _registry.mjs deterministic loader (malformed-skip-not-fatal); _trust-validator.mjs 0-100 scoring; greenhouse.mjs exemplary (hostname allowlist, redirect:'error', zero-token one-request)
port_verdict: moderate effort, high value — plain ESM, no build, no deps beyond fetch; vendor-sync weekly-diff model fits
downgraded_claims:
  - A–G offer-eval rubric = MARKDOWN PROMPTS (modes/oferta.md 7 blocks; modes/ofertas.md 10 weighted dims) — design reference to REIMPLEMENT, nothing to port
  - batch worker = 32KB bash driving headless Claude CLI (batch/batch-runner.sh) — pattern-only for pacing/retry, not a portable library
```

## 2.3 Others (JP1/JP2)

```yaml
jobhive_ats-scrapers:
  license: MIT verified · 48 scrapers (claimed 47) · ats-companies/ 28 CSVs, 63,515 slug rows
  quality: good — registry pattern, httpx async, retry/backoff, Pydantic v2 Job model, JOB_SCHEMA.md
  gray_zone: 6 browser/anti-bot-dependent files (_browserbase, _cloakbrowser, avature, jobsch, meta, tesla) — vendor the pure-JSON scrapers + CSVs; treat these 6 as optional/gray
jobspy:
  license: MIT verified · JobPost schema jobspy/model.py:239
  durability_confirmed: Indeed = internal GraphQL apis.indeed.com/graphql (indeed/__init__.py:48) most durable; Glassdoor GraphQL; LinkedIn = HTML scrape w/ 429 handling — best-effort only, never load-bearing (roadmap posture confirmed)
  anti_bot: RotatingProxySession + urllib3 Retry backoff (util.py) — proxy-dependent for gray-zone; fits ToS-tier off-by-default governance
jobfunnel:
  license: MIT verified · dedupe = jobfunnel/backend/tools/filters.py two-stage: exact key_id (find_duplicates:159) + TF-IDF cosine on descriptions, threshold 0.75, min-25-jobs gate + persistent duplicate registry
  CORRECTION: key_id is the SOURCE's job identifier (e.g. Indeed jk, provider-prefixed base.py:366), NOT company|title|location composite — adopt the two-stage pattern, the composite key is Bridge's own design
json-resume-schema:
  license: MIT verified · schema.json (499 lines: basics/work/volunteer/education/awards/certificates/publications/skills/languages/interests/references/projects/meta) + validator.js (jsonschema lib) — trivial Zod port
  note: Resume-Matcher does NOT use it — JobPilot must map ResumeData ↔ jsonresume explicitly
```

# 3. Calendar stack (CAL4–CAL6)

```yaml
ical.js:
  license: MPL-2.0 verified (v2.2.1, ZERO runtime deps, ESM) — file-level copyleft, fine as unmodified dep behind port
  recurrence: RecurExpansion (lib/ical/recur_expansion.js:53, .next() :219) handles multiple RRULEs+RDATEs+EXDATEs; EXDATE-in-DATE vs DTSTART-in-DATE-TIME mismatch explicitly coded (:264-266, :413-418) — the exact CAL5 eval edge, already in-lib
  recurrence_id: Event (event.js:36) — relateException :107, getOccurrenceDetails :206, RANGE=THISANDFUTURE :126-130/:226-260, strictExceptions — wrap Event.iterator()/getOccurrenceDetails, don't reimplement
  TZ_GOTCHA_CONFIRMED: timezone_service.js:15 "all manual registry" — reset() seeds only Z/UTC/GMT; NO IANA tzdb ships; IcsCodec must register inbound VTIMEZONE + delegate render math to Luxon
  parser: STRICT — throws ParserError on malformity (parse.js :56/:165/:216/:381); IcsCodec must try/catch per feed for the hostile-ICS fuzz gate
  pulse: healthy — commits thru 2026-06; real RRULE-math bugfixes landing (BYYEARDAY=366 wrap fix)
  verdict: CAL5 HIGH confidence; two wrapper duties (tz registration, parse catch) are IcsCodec seam work
react-big-calendar:
  license: MIT verified (v1.20.0, 2026-06-01, React 19 supported); luxonLocalizer EXISTS (src/localizers/luxon.js)
  resource_lanes: REAL — resources prop → utils/Resources.js grouping → TimeGrid renders one DayColumn per resource; two grouping layouts (resourceGroupingLayout); DnD = separate addon HOC
  CAL4_CRUX: NOT piecemeal-importable — TimeGrid/DayColumn/Resources are internal, unexported; lanes require mounting a FULL <Calendar views={['day','week']}> instance. CAL4 spike ADR should record: adoption = two engines behind CalendarView port (in-house grid for month/agenda + full RBC instance for lane view), never cherry-picked lane widgets
ical-generator:
  license: MIT verified, zero runtime deps (all peer/optional)
  api: ICalEvent.repeating() accepts RRULE string/options/rrule obj; exclude[]/excludeTimezone; recurrenceId(); floating()
  gotchas: checked-out tag = 11.1.0-develop.1 on develop branch — PIN A STABLE 11.x; does NOT generate VTIMEZONE — must wire vtimezoneGenerator hook (calendar.ts:519-535)
cal_diy:
  VERIFIED MIT (2026-07-13): github.com/calcom/cal.diy root LICENSE = MIT © Cal.com Inc; /ee subtree REMOVED not relicensed-in-place; community MIT continuation fork after cal.com hosted product went closed
  caveats: root-only check — full-tree license sweep at actual pinned commit before P6+ code contact; young fast-moving fork, re-verify at pin; huge transitive-dep tree = the real §4 gate
schedule-x:
  license: MIT across ALL published packages verified (v4.6.1, 2026-07-08); premium resource-view plugins are OFF-TREE (separately published, not in OSS repo)
  notes: @schedule-x/ical already wraps ical.js ^2.0.1; @schedule-x/calendar core zero-dep; theme-shadcn exists
  verdict: viable MIT month/week/day/agenda alternative behind CalendarView; hits the same paid wall as FullCalendar for lanes (CAL4)
cross_cutting: NEITHER ical.js NOR ical-generator ships tz data — one shared IcsCodec seam: (a) register inbound VTIMEZONE into TimezoneService pre-expansion, (b) Luxon for render math, (c) feed VTIMEZONE into ical-generator vtimezoneGenerator outbound. Budget explicitly in the CAL5 DST eval work — likeliest wrong-time-bug escape path
```

# 4. Builder stack (BA0/BA4/BA5) — appsmith / dyad / bolt.diy

Completed 2026-07-13 (retry after first pass died on session limit). Pins: appsmith `315b36c`, dyad `0ad4a23`, bolt.diy `2e254ac`.

## 4.1 appsmithorg/appsmith — ADAPT with attribution (BA4 git-projection)

```yaml
license: Apache-2.0 root, no per-file SPDX. CE/EE boundary is CODE-structural not directory-structural — every serialization class = *CEImpl (Apache, in-repo) + near-empty @Primary *Impl subclass; proprietary EE bodies NOT in this repo. Everything load-bearing for serialization = safely Apache-2.0
serializer:
  module: app/server/appsmith-git/ (self-contained Maven module)
  core: com/appsmith/git/files/FileUtilsCEImpl.java — saveArtifactToGitRepo(); DB → GitResourceMap intermediate (GitResourceType + relative path) → diffed vs on-disk tree → file-by-file write
  layout: root application.json/metadata.json/themes; pages/ (canvas.json widget DSL per page), queries/, jsobjects/, datasources/, jslibs/ (GitDirectoriesCE.java); DSL split/reassemble = DSLTransformerHelper.java
  determinism: GsonUnorderedToOrderedConverter + GsonDoubleToLongConverter — stable diffs
  orchestration: per-entity ExportableService plugins (applications/newpages/newactions/datasources exportable/)
secrets_exclusion:
  file: appsmith-server/.../datasources/exportable/DatasourceExportableServiceCEImpl.java sanitizeEntities() :150-182
  git_path: isGitSync=true → ENTIRE datasourceConfiguration nulled (:171-172) — credentials structurally absent from the tree
  escape_hatch_TRAP: exportWithConfiguration==true AND serialiseFor==SHARE serializes DECRYPTED secrets (:158-166, their internal sample-apps path) — Bridge port must DROP this branch entirely
verdict: GitResourceMap + ExportableService + null-config-on-git-sync maps ~1:1 onto Bridge "DB as truth, git as projection; secrets never serialize"; flatten the Spring CE/EE @Primary ceremony on port
```

## 4.2 dyad-sh/dyad — Apache core ADAPT / FSL src-pro CLEAN-ROOM

```yaml
license_boundary:
  root_LICENSE: everything outside src/pro = Apache-2.0; src/pro/LICENSE = FSL-1.1-ALv2 (builder SaaS = Competing Use; converts to Apache 2yrs/version)
  TRAP: root package.json says "MIT" — CONTRADICTS root LICENSE; LICENSE/NOTICE files govern, package.json field is wrong. Never cite it
fsl_walled_clean_room_only:
  - Smart-Context/Turbo-Edits: src/pro/main/prompts/turbo_edits_v2_prompt.ts + search_replace_{parser,markers,processor} DSL
  - entire agent engine: src/pro/main/ipc/handlers/local_agent/ (~60 tools, MCP auto-consent, plan/todo persistence)
  - visual editor Annotator
apache_core_reusable:
  chat_turn_commit: src/ipc/processors/response_processor.ts processFullResponseActions() — parses <dyad-write> tags (src/ipc/utils/dyad_tag_parser.ts, Apache), writes files, ONE commit per turn (:714-760), commitHash persisted onto messages row (db/schema.ts messages.commitHash :154; versions table unique(appId,commitHash) :182/:197); outside-edits folded via amend = the chat-turn≡ledger invariant, verified
  additive_restore: src/ipc/utils/git_utils.ts gitStageToRevert() :507-560 — reset --hard target THEN reset --soft current → revert lands as NEW commit on top, history never rewritten; refuses dirty worktree = "restore is additive; rollback forks", verified
  approvals: settings-driven auto-approve switches (AutoApproveSwitch/Sql/Mcp .tsx); Proposal type carries commitHash; ENFORCEMENT of safe-MCP auto-consent lives in FSL → pattern only
  keychain_secrets: src/main/settings.ts — Electron safeStorage encrypt on provider apiKeys (:442), OS-keychain-backed, keychain-locked-at-launch recovery logic; secrets never in the app git repo
BOUNDARY_TRAP: Apache response_processor.ts:49 IMPORTS applySearchReplace from FSL src/pro — a naive "copy the response processor" vendors FSL code. Sever at that seam: full-write path Apache-reusable, diff-edit apply clean-room
```

## 4.3 stackblitz-labs/bolt.diy — MIT, parser/diff/locks ADAPT; runner reference-only

```yaml
license: MIT clean throughout (root LICENSE + package.json consistent)
parser_ADAPT: app/lib/runtime/message-parser.ts — StreamingMessageParser incremental char-scan state machine over <boltArtifact>/<boltAction>, callbacks onArtifactOpen/Close onActionOpen/Stream/Close, partial-tag buffering, #extractAttribute :359-375; VERIFIED WebContainer-free → runtime-agnostic, portable; tests + golden snapshots ship (message-parser.spec.ts)
runner_DO_NOT_ADOPT: app/lib/runtime/action-runner.ts — constructor takes Promise<WebContainer>; fs/spawn via webcontainer (:316-466). The WebContainers dependency is CONCENTRATED HERE, not in the parser — reuse the contract, re-author the executor for Tauri/sandbox
asymmetric_diffing_ADAPT: app/utils/diff.ts — generation always full-file; feedback picks per-file whichever is SMALLER: unified diff (createTwoFilesPatch) vs full content (:36-45, type:'diff'|'file' union); serialized into <MODIFICATIONS_TAG_NAME> block (:101). Roadmap claim confirmed at code level
file_locking_ADAPT: app/lib/persistence/lockedFiles.ts — LockedItem scoped per chatId, localStorage key bolt.lockedFiles + in-memory Map cache; API app/utils/fileLocks.ts; enforced in files/workbench stores + editor guard. TRAP: client-side localStorage only, no server guarantee — Bridge re-backs with definition DB + stable node IDs
prompt_library_CORRECTED: app/lib/common/prompt-library.ts is a user-selectable VARIANT registry (default/optimized/original — promptId-driven), NOT model-conditioned routing. Roadmap's "per-model prompt packs" framing = Bridge's own extension of the registry pattern; the pluggable get(options)=>string registry is the reusable idea
```

## 4.4 Builder deltas applied

```yaml
applied:
  - dyad package.json "MIT" mislabel recorded (LICENSE governs)
  - response_processor→src/pro FSL import seam recorded (sever on port)
  - appsmith SHARE+exportWithConfiguration secret-serializing branch = drop on port
  - bolt.diy prompt handling reframed: variant registry (adopt pattern), per-model packs are Bridge's extension
  - action-runner = reference-only (WebContainer-bound); parser/diff/locks = adapt
```

# 5. Roadmap deltas applied from this diligence

```yaml
applied:
  jobpilot_plan_s4:
    - career-ops link resolved (santifer/career-ops); providers=54; rubric+batch downgraded to design-reference (prompts/bash, not portable code)
    - JobFunnel key_id corrected: source identifier, not composite; composite key stays Bridge design
    - Resume-Matcher upgraded: PROTECTED_FIELDS blocklist + diff gate + scorers + judge all exist in code; note ResumeData≠jsonresume remap + jd_added tightening
  calendar_plan_s4:
    - cal.diy license suspicion RESOLVED (MIT verified root, /ee removed; full-tree sweep at pin)
    - react-big-calendar lanes = full-instance-behind-port, not piecemeal (pre-answers the CAL4 spike shape)
    - ical.js/ical-generator shared tz-data seam recorded as CAL5 work item
  learning_roadmap_s4:
    - mem0: telemetry-off + explicit-local-config as MUST items; wrap-don't-copy; taint via metadata JSONB
    - firecrawl: preferred verdict now port-safeFetch-pattern + direct Playwright (option 1); engine adoption demoted
    - stagehand: LOCAL mode, extract/observe only through the port; Bridge fronts SSRF
```
