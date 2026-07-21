# Security — vuln audit + prompt-injection

full: [../raw/security-audit-2026-07.md](../raw/security-audit-2026-07.md) · 2026-07-08. Bug rows filed in [BUGS](../BUGS.md).

**2026-07-21 closure:** TASK-015 RT0–RT4 closes the runtime-taint root gap. Unknown/malformed labels quarantine; instruction-bearing untrusted data cannot enter authority-bearing Skill/model contexts; egress joins all context; declassification is validator/Human-only and immutable; Approval warning/trace plus prompt-free replay/alerts are live. The older audit text below remains historical evidence.

**Verdict: no CRITICAL. The governance/agent-floor design is genuinely strong — human-only
approvals, agent-floor DENY, `external:send` gating, idempotent draft-only egress all hold. The
HIGH items undermine the *identity* feeding that otherwise-sound gate, not the gate itself.**

## Vulnerability findings (ranked)
- **H1 — no auth enforced by default.** `apps/api/src/identity.ts:84-91`: no JWT secret / no
  `Authorization` header ⇒ silently runs as pilot user. No `protectedProcedure` in `router.ts`;
  only workspace-id checked, never token presence. H1a: `corsOriginConfig()` defaults `origin:true`
  off-prod. Any reachable non-prod/misconfig deploy = unauthenticated full pilot access. **Top fix.**
- **H2 — vulnerable deps.** `drizzle-orm ^0.38.3` (SQLi GHSA-gpj5-g38j-94v9, patch ≥0.45.2) +
  HIGH `react-router` advisories (turbo-stream RCE / javascript: XSS / manifest DoS). Bump + CI audit gate.
- **H3 — Tauri `csp: null`** (`tauri.conf.json:15-17`). Shell hosts apps/web + `sensor_bridge` +
  injects API URL ⇒ any web XSS gets unrestricted webview into IPC. Set explicit CSP.
- **H4 — no rate limiting** anywhere (`server.ts` = cors+tRPC only). With H1 ⇒ flood/brute-force/
  cost-amplify. Add `@fastify/rate-limit`.
- **M1** RLS policies ABSENT from tracked migrations (app-layer `assertPilotWorkspace` is the only
  guard) · **M2** workspace invite/list lack membership check (horizontal-priv-esc at multi-tenancy)
  · **M3** Recon SSRF (no RFC1918/metadata denylist, unauth Next routes) · **M4** dummy phone-OTP
  feeds unqualified `phoneVerified` trust flag · **M5** no log redaction (phone/code/Authorization)
  · **M6** `linkedin` verification is client-asserted, no proof.
- **Positives worth keeping**: `action.decide` resolves approver from server identity never body ·
  `agent-floor.ts` = single source of truth (3 call sites, fixed past drift) · `EgressExecutor`
  idempotent + draft-only · no raw SQL / `eval` / `child_process` · desktop sidecar binds 127.0.0.1
  · Tauri capability manifest minimal.

## Future risk register (features not built yet — design in now)
Capability packages gaining executable logic ⇒ supply-chain RCE (sandbox in isolate, extend
lethal-trifecta union to sandbox caps) · Commons registry supply-chain (sign manifests, TLS, treat
community-origin as untrusted as user_code) · capture core expansion (blink event must originate in
Rust core, un-spoofable from webview; re-confirm OS perms periodically) · **MCP/tool integrations:
tool output = untrusted DATA, never operator instruction** — must flow through dataScope/egress
gates, never directly trigger a `propose()` without a human (write an ADR before first MCP ships).

## Prompt injection
**Verdict: MODERATE-to-HIGH for content-integrity / social-engineering of the human approver;
LOW for autonomous exfiltration.** The governance spine genuinely stops the canonical attack
("email says forward all contacts to attacker@evil.com") via THREE independent, code-enforced
controls: agent-floor Layer-0 DENY on `external:send` (`authority.ts:387`) · draft-only egress
(requests `gmail.drafts.create`, never `.send` — `egress.ts`, `contracts.ts:118`) · agents-always-
draft review gate (`pipeline.ts:79`). That's a real moat.

**But the whole defense collapses to "agents draft, a human approves."** There is **NO runtime
notion of tainted content** — nothing tags an email body / captured screen / scraped page as
untrusted (grep for taint/untrusted = nothing), and the celebrated **lethal-trifecta rule is a
STATIC install-time manifest audit** (`package/risk.ts:48`), NOT a runtime data-flow check. So a
crafted injection can produce a *plausible draft* a fatigued approver rubber-stamps, poison Memory,
mislabel people, or steer advisory-band actions that auto-activate within the daily budget with no
human.

**Top-5 injection-adjacent vulns**: (1) **no provenance/taint on ingested content** — root gap,
HIGH · (2) **OAuth access+refresh tokens stored PLAINTEXT** in local pglite (`local/src/stores/
pglite.ts:81`) despite "SecretStore" naming — local account-takeover, HIGH · (3) **RLS does not
exist** — every table `isRLSEnabled:false`, contradicts `client.ts` + resilience wiki; isolation =
app-level filters only, HIGH at multi-tenant · (4) **plane tag is client-asserted**
(`router.ts:169`→`authority.ts:73`) — the field the local-first egress guarantee rests on comes
from the client (mitigated only by cloud→public scope clamp), HIGH · (5) **no signature/publisher
verification on foreign imports**; MCP imports exempted from sandbox "by protocol"
(`importer.ts:96`), HIGH (future).

**Defense plan (build the moat — pure-additive, local-first):**
1. **Highest leverage — end-to-end provenance/taint tagging + gate tool/egress on tainted context.**
   The runtime complement to the static trifecta: tag every ingested artifact `operator |
   user_content | untrusted_external` from the ingestion edge through the ledger; a turn whose
   context holds any `untrusted_external` is **structurally denied** `external:send`/egress →
   human-in-loop. Activates the already-declared-but-dead `intake_policy.quarantine` flag.
2. **Spotlighting/delimiting + dual-LLM quarantine (CaMeL pattern)** — untrusted content read by a
   tool-less quarantined model that emits only typed extractions; privileged agent never sees raw
   untrusted text. Quarantined model can be local (privacy-first).
3. **Approval-UI "influenced by untrusted content" banner** — surface taint to the approver so the
   review gate isn't blind.
4. **Adopt local-weight classifiers** (Prompt Guard / Llama Guard) behind a `ContentGuard` port —
   explicitly AVOID SaaS detectors (Lakera etc.) for private-tier content: they'd violate the
   no-external-egress rule. Same build-the-moat logic as the OPA/OpenFGA reject.
5. **Fix the enablers**: encrypt OAuth tokens at rest, make the plane tag server-derived not
   client-asserted, sign imported manifests, land real RLS.

Roadmap: taint + tainted-context gating = P0/Month-3; spotlighting + dual-LLM + ContentGuard port =
follow-on; sign/encrypt/RLS = Months 1–3 security track. Full: [../raw/security-audit-2026-07.md](../raw/security-audit-2026-07.md).
