# External agents

full: [../raw/external-agent-access-plan-2026-08.md](../raw/external-agent-access-plan-2026-08.md) · 2026-08-06, ADR-194/AP-114. **PLAN ONLY — nothing built, no TASK rows.**

Outside agent (Claude Code, any MCP client) builds Modules/Databases/Skills/Automations for a
Bridge install. Two modes: **dev-time** = repo edits, already governed by git+PR+CI. **runtime**
= the plan below.

**Three sentences carry it:**
- *Structurally absent, not policy-denied* — no `activate` tool exists to deny.
- *Introducing a new state is a human decision; returning to an old one is not* — propose needs
  approval, restore does not.
- *Restore restores the document, not the world* — Bridge's qualifier, §4.3.

## Slices

- **EA0 local stdio gateway** — 6 tools: describe_surface · get_configuration · list_versions ·
  get_version · propose_change (validated+diffed, NOT applied) · restore_version. stdio ⇒ no
  network boundary ⇒ **auth is not a prerequisite**. Gateway = client of Bridge's own pipeline,
  never a second reader of the store. Distinct principal `mcp:external-agent`, visible in
  history. Validation errors return to the agent for self-correction. Unknown id ⇒ whole
  document refused, nothing written. **Dep (unverified): does a configuration version ledger
  exist today?**
- **EA1 import-graph isolation test** — walk transitive imports from gateway entry, fail on any
  reachable first-party file naming a personal-data table + exclude data-path modules by name +
  **fail if walker resolves too few files** (vacuity guard). Verify by breaking it. Cheap, do
  early, independent of EA0.
- **EA2 restore + qualifier** — unattended ONLY if references still resolve identically AND no
  referenced capability's trust band / credential grant moved. Else degrade to proposal. Notify
  + rate-limit external restores. History properties: single writer · forward-only · normalized
  not delta · baselined.
- **EA3 networked gateway** — only if non-stdio wanted. THEN H1 auth + scoped expiring tokens +
  `untrusted_external` taint labels become required BEFORE the transport ships.
- **EA4 shrink the code-bearing surface** — not "sandbox everything". Make View/Database/Page/
  layout schema structurally unable to hold code or markup (component names bindings, app looks
  value up) ⇒ no sandbox needed there. Keep BA0 sandbox only for bodies that execute. Folds into
  BA0/BA1. **Rule: a sandbox must never justify a looser schema.**
- **EA5 agent-legible + dev-time** — `AGENTS.md` inside the installed build; live
  `describe_surface` is the primary contract, published docs secondary. Dev-time: CODEOWNERS is
  ceremony at one human — use tests that always run (isolation guard, assertion that fails if an
  `activate`-shaped tool appears, forward-only history). Ecosystem/public-spec push DEFERRED (one
  user).

## Learn from Avilo Advisory first

Sibling codebase built substantially this design against an earlier draft and **shipped it**.
Its `docs/wiki/mcp.md` + `AGENTS.md` + ADR-041/042/043/044 = reference implementation. Read
before building EA0. It corrected four things:

1. **Transport determines the security requirement** — auth was made an unconditional blocker;
   it is not, for stdio. Un-coupled, not cancelled.
2. **Isolation belongs in the import graph, not a helper call** — a helper guards today's tools,
   not the import someone adds in six months, three files away.
3. **Restore/propose asymmetry** — genuinely new, plan lacked it. Bridge has the append-only
   substrate, was missing the permission conclusion.
4. **The sandbox recommendation was overbuilt** — sandboxing is for emitted CODE; a
   bindings-only schema dissolves the risk, and a sandbox there invites later schema relaxation.

Kept where Bridge differs: taint lattice (Avilo has one door, Bridge has email/capture/scrape/
Commons/MCP/external-agent ⇒ lattice earns its cost) · loopback-API route not direct store access
(Avilo recorded same-file access as an honest limit; Bridge has an API + authority plane, so the
cheap path is a regression) · restore guard (§4.3).

Also stolen: `drizzle-kit generate` re-emitting `CREATE TABLE` for hand-written un-snapshotted
migrations would fail on every existing install — Bridge is at 0038 with hand-authored
migrations.

## Vendo

[runvendo/vendo](https://github.com/runvendo/vendo) Apache-2.0 = embedded agent for a SaaS's END
CUSTOMERS; acts as signed-in user, iframe jail, one guard, opt-in MCP door. Converges with Bridge
(single choke point, constrained format, approval-gated) = independent validation. But: no taint,
no residency planes, no versioned capability lifecycle; it retrofits adaptability onto static
products, which is what Bridge is natively. **Pattern source only** — 6th alongside bolt.diy/
Dyad/Budibase/Appsmith/ToolJet. No reuse intake unless a specific import is proposed. NEVER run
its guard as a second governance plane beside Bridge's authority plane.
