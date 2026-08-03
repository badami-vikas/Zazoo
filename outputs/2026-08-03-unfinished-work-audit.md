# Unfinished / unconnected work audit — 2026-08-03

Four parallel read-only agents over `platform/` + repo state. Distinct from the
2026-08-02 bloat audit: that one found code that is *unused*; this finds code that
is *unfinished, unreachable, or unwired*. Every claim below was verified by the
reporting agent; the two highest-stakes ones were re-verified directly.

---

## TIER 0 — loss or security risk, act now

**0.1 — 52 commits of WhatsApp work exist only on local disk.**
Verified directly: `git ls-remote --heads origin` finds NONE of the 13 WhatsApp
branches. `claude/whatsapp-module-contact-extractor-9cfff3` (tip `48a971c`) is a
strict superset — `git rev-list --count contact-extractor..<each other>` = 0 for
all twelve. Landing that one lands TASK-029 + TASK-030 entirely; the other twelve
are checkpoints, deletable with zero loss afterwards. **A disk failure loses the
whole WhatsApp Module.** Not pushed here because it is contact-extraction code and
the repo carries a PII pre-commit hook — needs the owner's explicit go-ahead.

**0.2 — Other work at risk of being lost**
- `stash@{0}` on `claude/xenodochial-lamarr-9e9247`: 51 files, +3351/−516, dealpilot/
  jobpilot connectors, from 2026-07-04. Month-old and invisible.
- Uncommitted DB migration `platform/packages/db/migrations/002_add_location_geo.sql`
  in worktree `romantic-kowalevski-2a3e18` (+ `Tools/recon/lib/geocode.ts`).
- Uncommitted `platform/apps/api/test/authentication.test.ts` in worktree
  `codex-roadmap-batch-1`.
- Unpushed single-commit branch `worktree-agent-a1b0df5fd0a4fa8a8` (2026-07-07,
  447 behind): `feat(core): foreign-capability importer (Track F3)`, 7 files.
- 15 of 35 worktrees are dirty. The MAIN checkout is **299 commits behind
  origin/main** — do not build or deploy from it.

**0.3 — Security debt with no owning task** (docs/BUGS.md, OPEN 2026-07-08)
OAuth access + refresh tokens stored **plaintext** in local pglite. SECURITY M1–M6:
RLS absent from tracked migrations; `workspace.inviteMember/listMembers/create`
lack membership checks; dummy phone-OTP feeds `phoneVerified`; no log redaction;
client-asserted `linkedin` verification. Recorded as a multi-tenancy hard blocker
and sitting in the unassigned tail of the bug ledger.

---

## TIER 1 — production is silently wrong

**1.1 — `BRIDGE_APP_URL` is set nowhere.** `apps/api/src/google-oauth-routes.ts:39`
falls back to `http://localhost:5173`, so the DEPLOYED OAuth callback redirects to
localhost. Absent from render.yaml, every `.env*`, CI, and docs.

**1.2 — `policyParams` is in-memory in BOTH modes.** `wiring.ts:4740`
`new InMemoryPolicyParamStore()` sits outside the persistent/in-memory split. Its
only consumer, `router.ts:12912` `resolveGates(...)`, therefore always reads
defaults and every write dies at restart — while a real `policyParams` pgTable
exists at `packages/db/src/schema.ts:966` with no store bound to it. Governance
gates are not actually tunable in production.

**1.3 — Rate limits are unconfigured.** `API_RATE_LIMIT_MAX` /
`_SENSITIVE_MAX` / `_WINDOW_MS` (`apps/api/src/server.ts:166-168`) are set nowhere;
the hardcoded 300/10/60s defaults silently govern production.

**1.4 — CI's last fully green run on `main` was 2026-07-08** — ~4 weeks. The
`check:vocabulary` failure recorded in docs/BUGS.md (2026-08-03) masks two
INDEPENDENTLY red jobs — `prototype (typecheck + build)` and `security audit
(no HIGH+ vulnerable deps)` — plus `desktop installers (tauri build)`, which is
**skipped on every run**: a defined job that has never actually executed.

---

## TIER 2 — shipped but unreachable or unmanageable

**2.1 — Three routed pages have no inbound link**: `/research` (the TASK-028
Research Run detail Page, shipped 2026-07-31), `/chief-of-staff`, `/organization`.
Reachable only by typing the URL. `/research` is the notable one — a just-shipped
feature that is effectively invisible.

**2.2 — Child Agent Runs can be written but never managed.** `childRun.get`
(:15132), `childRun.listByParentRun` (:15140) and `childRun.cancel` (:15169) have
no client caller, while `DrizzleChildAgentRunStore` is real and durable. The
research flow writes child-Run records the UI can neither list nor cancel.

**2.3 — `EventBus` is emit-only.** `packages/core/src/ports.ts:183` defines only
`{ emit }`; the sole emit site is `pipeline.ts:807`; `memory/stores.ts:347-368`
states outright that "nothing in `@bridge/core` ever reads `events` back out."
Every domain event lands in a 10k ring buffer and is dropped — so Automations and
Signals cannot be event-driven today.

**2.4 — 52 of 214 tRPC procedures have no client caller.** Whole surfaces:
`capability.*` (10 procedures, superseded by `modules.*` — a dead front door over
real persisted storage) and `jobpilot.cultureResearch.*` (9 procedures plus four
dedicated stores in wiring, awaiting a JobPilot culture UI). Plus scattered
uncalled procedures across taskManager, action, relationship, integration,
onboarding, redFlag, organization, graph, modules, chat, capture.

**2.5 — `ControlPanel.tsx` is built and mounted nowhere**, while CLAUDE.md canon
requires "Control Panel in 3-dots". The 3-dots slot currently holds a link to
`/module/<id>` instead.

**2.6 — Canon violation: Duplicate and Pin are dead on every page.**
`TableView.tsx:203,206` gate on `onDuplicate`/`onPin`, which NO page passes — and
unlike the sibling Delete at :211, they carry no `title` explaining why. `onDelete`
(`dataviews/types.ts:71`) is referenced by nothing at all. Same defect class,
smaller blast radius, in CalendarView/BoardView/GalleryView/TreeView.
`StandardColumnMenu`'s Group tooltip claims a per-column condition that does not
exist (`onGroup` is never passed).

**2.7 — Unwired-but-instantiated**: `credentialBroker` (`wiring.ts:4360`) is
constructed, typed, exported, and read by nothing. `evalStore` is in-memory in
both modes and reachable only through the client-less `capability.orgHealth`.

**2.8 — The Commons service is never deployed.** `services/commons/src/main.ts:13`
throws without `COMMONS_PUBLISH_TOKEN`, which is set nowhere; render.yaml defines
no commons service; `HttpCommonsClient` defaults to `localhost:4780`, so every
production `commons.*` call fails to a fetch error.

---

## TIER 3 — stalled on a decision, not on engineering

- **AP-007 + AP-008 are PROPOSED, and are the *only* thing blocking TASK-019**
  (observability, Memory lifecycle, sandboxing).
- **AP-022** — Bridge→Zazoo platform rename (recommendation on file: don't;
  needs trademark clearance).
- **TASK-027** needs five at-keyboard live checks (V2 local-path ask, V7/V8
  degradation, V9 multi-monitor, V10 sensor-drain blink) — pure owner time.
- **TASK-022** is code-complete, blocked on an authorized Anthropic credential +
  live-test spend authorization.
- **TASK-006** is blocked with deployed source manually pinned at `163562a` while
  `main` moved on, and 8 seeded demo Deals standing in for real pilot data in the
  public cloud (tracked in docs/dummy.md).

---

## TIER 4 — consciously deferred (recorded, not forgotten)

TASK-031's own remainder (router.ts/wiring.ts/graph-store.ts splits + six
consolidations, deferred behind the WhatsApp branches); `NotImplementedContainer
SandboxProvider` (honest fail-closed stub, TASK-019); the Windows secure-listener
gap (`api_sidecar.rs:216`, TASK-018); sensor_bridge on-demand-only stub; ADR-034
browser companion; ADR-047 AX-tree walking; ADR-078 XP-2/XP-3; ADR-156's
kernel-executor bridge.

Code hygiene is genuinely excellent: **zero** TODO/FIXME/HACK/XXX in the entire
`platform/` tree, no commented-out JSX, no `href="#"`, no console-log-only
handlers, and no untracked runtime dummies in the web app.

---

## Recommended order

1. Push the WhatsApp superset branch (owner go-ahead needed), then recover the
   stash, the loose migration, and the loose auth test.
2. Fix `BRIDGE_APP_URL` and bind a `DrizzlePolicyParamStore` — both are cases where
   production behaves differently from what the code claims.
3. Assign the 2026-07-08 security block (plaintext tokens, M1–M6) to a task.
4. Unblock TASK-019 by deciding AP-007/AP-008.
5. Link `/research` into the nav; either pass `onDuplicate`/`onPin` or give them
   explanatory titles; mount or delete `ControlPanel`.
6. Decide per surface whether the 52 client-less procedures are awaiting a UI or
   should be removed (`capability.*` is the clearest deletion candidate).
