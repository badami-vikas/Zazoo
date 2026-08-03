# Open-Source Adoption Policy

2026-08-03. Tier C decision record. Ratifying means promoting to `docs/raw/` with a wiki companion,
an ADR in `docs/raw/decisions-log.md`, and an `docs/APPROVALS.md` row — this is not policy until then.

**Scope: open-source licenses only.** Service terms of use are explicitly *out* of scope and handled
by §7 (disclose the risk, the user decides).

---

## 1. The hinge: yes, Commons is redistribution — for one carrier out of three

Publishing to Commons is distribution. `CommonsModuleEntry` serves a signed manifest, canonical
content, and `dependencyPins` with content hashes; Bridge Cloud later serves the same contract from a
hosted deployment. Anything whose *expression* travels through that channel has been distributed, and
distribution is precisely the trigger GPL-family licenses key on.

But Commons carries three different kinds of thing, and only one of them carries expression:

| Carrier | What Commons actually serves | Distribution of the covered work? |
|---|---|---|
| **Module** | Built code + pinned dependency closure | **Yes.** Full distribution obligations |
| **Skill** | A `SkillManifest` — input/output schemas, permissions, plane, budget. **No code payload** | **No.** A contract that *triggers* code is not the code |
| **Agent** | Authority, allowed Skills, deployment posture | **No.** It is the enforcement layer |

This is not a loophole; it is the ordinary line between an interface and an implementation. It is also
the single most valuable structural fact Bridge has, because it means **a license that forbids
bundling does not forbid capability.** The capability moves to a carrier that does not distribute.

**Consequence — the carrier is chosen by the license, not by convenience.**

---

## 2. The obligation vector (open source only)

Replace Commons' single-valued `repositoryLicense` / `contentLicense` with a vector. Obligations are
the union across axes, evaluated against the carrier and the deployment shape.

- **A1 — Code license.** Permissive · weak copyleft · strong copyleft · network copyleft ·
  restricted. Recorded as **`wrapperLicense` and `payloadLicense` separately** — never collapsed.
  CloakBrowser is MIT wrapper + proprietary binary; Firecrawl is AGPL engine + MIT SDKs. One field
  gets both wrong.
- **A2 — Patent grant.** `explicit` (Apache-2.0, MPL-2.0) · `absent` (MIT, BSD) · `retaliation`.
  Matters the moment a capability is resold rather than used. This is why Apache-2.0 outranks MIT for
  anything Bridge intends to publish.
- **A3 — Data rights.** Separate from code, because the code being MIT says nothing about the corpus.
  `attribution_required` · `share_alike` · `commercial_use` · `redistribution_of_derived_records`.
- **A4 — Notice obligations.** What must ship, and where — file, UI, or both.

**Deployment shape** is the multiplier: `internal_only` · `customer_hosted` · `bridge_hosted` ·
`commons_published`. Note the fourth: for Bridge, `commons_published` *is* the distributed shape.

**Obligations are computed, not assigned.** `AGPL × Skill × customer_hosted` is fine.
`AGPL × Module × commons_published` is a violation. No reviewer should have to hold that in their head.

---

## 3. The demotion ladder — nothing researched is ever wasted

The rule: **a source that cannot be adopted at one carrier falls to the next, and only falls off the
bottom if it fails all four.** "We rejected it" is never the end state; the end state is always a
carrier.

1. **Module** — permissive payload (A1 permissive, notices generated). Bridge ships the code.
2. **Skill** — any license, including AGPL and restricted. Bridge ships the *contract*: adapter
   interface, prompts, guardrails, evals, wiring, deployment instructions, and a bring-your-own
   install or key. The user supplies the implementation and owns its obligations.
3. **Pattern Skill** — where even referencing the implementation is unsafe (restricted licence,
   patent, trademark). Bridge publishes the *behaviour*: features, outcomes, approach, benchmarks —
   and the Builder Agent reimplements independently. This is the existing
   [clean-room protocol](../docs/raw/clean-room-capability-research-protocol-2026-07.md), and its
   rule holds: whoever read the restricted source does not write the alternative.
4. **Decision-log note** — the residue. Recorded so the next person does not re-research it.

Rungs 2 and 3 are where most of the value is, because they are how Bridge captures worth from
software it may never bundle.

---

## 4. The Agent carrier is the enforcement point

An Agent published to Commons declares the deployment posture its Skills may run under —
`customer_hosted_only`, `internal_only`, `byo_license`, `byo_install`. Bridge's runtime already has
the machinery: `SkillManifest.permissions` are requirements the resolver *checks* and never grants,
and `resolveSkillForTask` only ever narrows. Deployment posture becomes one more thing it narrows on.

So the policy is enforced by the same fail-closed resolver that already enforces authority, rather
than by a compliance document nobody reads at 6pm.

---

## 5. Re-reading the whole research corpus through this lens

Every source examined while building the Learning capability plan, placed on a carrier. Nothing is
discarded.

| Source | License reality | Carrier | What the user gets |
|---|---|---|---|
| **recon's 35 connectors** | Bridge-authored, calling public APIs | **Module** | Ships directly. A3 recorded per source (OFAC public domain, OpenAlex CC0, WhatsMyName data terms) |
| **mem0** | Apache-2.0 — **patent grant present** | **Module** | Best-in-class carrier. A2 explicit makes it safer to publish than an MIT equivalent |
| **Stagehand** | MIT, LOCAL mode | **Module**, extract/observe only | `act()` gated off for a `neverExecutes` agent |
| **zod, @napi-rs/keyring** | MIT | **Module** dep | Generated notice, nothing else |
| **Firecrawl** | AGPL engine **+** MIT SDK | **split** — SDK as Module dep; engine `customer_hosted` only | A1 split resolves by construction what the roadmap resolved by argument |
| **SearXNG** | AGPL | **Agent** enforcing `customer_hosted` | Real search recall, never Bridge-hosted |
| **CloakBrowser** | MIT wrapper **+** proprietary binary; OEM to distribute | **Skill** + `byo_install` | Reader adapter contract; user installs the binary under their own terms |
| **Context.dev** | Hosted service | **Skill** + `byo_key` | Adapter + evals; user holds the entitlement |
| **Coasty** | Hosted computer-use | **Skill** + `byo_key`, Builder-side | Available without Bridge hosting VMs |
| **Rindler** | Hosted; session-reuse rejected on residency | **Pattern Skill** | "Map a site once into deterministic typed tools" — the pattern, not the service |
| **WUPHF** | Sustainable Use — bars serving third parties | **Pattern Skill** | The highest-value rung-3 case: notebook→wiki promotion, `/lint` contradiction sweep, per-agent tool scoping. Builder reimplements |
| **Prized, LemonLime** | SaaS, no license surface | **Decision-log note** | Competitive validation of the governance posture |

**WUPHF is the proof the ladder works.** Under the five-tier model it was simply "reject." Under the
ladder it becomes a Pattern Skill teaching the Builder Agent a memory-promotion design that maps
directly onto LA0's propose→accept and a freshness sweep that maps onto
`knowledge-freshness-sweep`. Same license, same restriction, entirely different outcome for the user.

---

## 6. Re-reading DealPilot and JobPilot through this lens

The earlier pass asked "what third-party code do they carry?" and found almost none. The right
question is **"what does the research corpus let them do that they cannot do today?"**

**DealPilot** — the recon salvage is a direct capability transfer, all Module-carrier:
GLEIF (legal-entity truth for funds and counterparties) · SEC EDGAR + XBRL revenue · Form ADV/IAPD ·
ProPublica 990 (foundation and endowment LPs — directly the ETA use case) · USAspending (govcon
revenue floor) · CourtListener and UCC (risk Signals) · and `gpFundEconomicsEnrich` /
`privateRevenueModelEnrich`, which produce banded estimates with provenance for exactly the private
long-tail DealPilot targets.

**JobPilot** — Greenhouse and Lever connectors already exist in the salvage and migrate straight in.
ATS access is a ToS question, so it routes to §7 and the user decides.

**Both at once** — recon's `mergeCandidates` and tier logic land in `@bridge/dedupe`, which both
Modules already depend on. One migration, two Modules improved. That is the payoff for consolidating
into a seam instead of a fourth loop.

---

## 7. Service terms are out of scope — disclosed, not enforced

Per direction, ToS is not gated by this policy. Instead:

- Any capability reaching a network service declares `serviceTerms: { url, retrieved, summary }` on
  its manifest.
- At install or first run, the user is shown the risks in plain language — automation permitted or
  not, rate and volume limits, resale, whether their own account bears the consequence.
- **The user decides and the decision is recorded.** Bridge does not block.
- One carve-out survives, and it is a safety rule rather than a licence rule: capabilities that would
  put the user's own credentials or live session on third-party infrastructure are refused outright.
  That is why Rindler's session reuse is rejected while its pattern is kept.

---

## 8. The anti-digression gate

The policy exists as much to stop capability sprawl as to stop licence violations. Every intake must
answer three questions mechanically, and **failing any one is a rejection regardless of licence**:

1. **Which existing port does it land behind?** `ModelProvider`, `MemoryStore`, `SearchProvider`,
   `ResearchPageReader`, `SourceConnector`, `ContentGuard`. A source needing a *new* port needs an ADR
   first. No port, no adoption.
2. **Which plan step does it serve?** A named step in a current plan or TASK. "Interesting" is not a
   step.
3. **What does it retire?** Every adoption names the parallel loop it removes, or explains why none
   exists. This is the clause that would have caught recon, the Run engine, `skill.webResearch`, and
   `@bridge/sourcing` becoming four answers to one question.

A capability that cannot be expressed as port + adapter is a design finding, not a legal one — and it
is rejected on those grounds.

---

## 9. Mechanics

- **`licenseProfile` extends `CommonsProvenance`** — the existing structure with
  `repositoryLicense` / `contentLicense` / `licenseVerified` becomes the vector. Not a new registry;
  a parallel compliance store would itself be a digression.
- **A licence check joins `CommonsSecurityScan.checks`**, which is already a versioned gate
  (`policyVersion: "CM1-2026-07"`). Publishing computes obligations from vector × carrier × shape and
  fails closed on unknown — matching the taint lattice's existing rule.
- **Notices are generated** from manifests at package time. Apache-2.0 §4 compliance becomes a build
  artifact, never hand-maintained.
- **Only genuine commercial-term questions reach a human**, and ambiguous cases stop for counsel, per
  the existing CLAUDE.md rule.

---

## 10. The policy, stated

1. Commons publication is distribution. **Module carries expression; Skill and Agent do not.**
2. Carrier is chosen by licence, never by convenience.
3. Obligations are **computed** from vector × carrier × shape, never assigned by hand.
4. Wrapper and payload licences are recorded separately, always.
5. **Nothing researched is discarded** — it descends the ladder to Module, Skill, Pattern Skill, or a
   decision-log note.
6. Bridge never hosts network-copyleft or restricted payloads without an APPROVALS row naming the
   reviewed operating model.
7. Bring-your-own licence or install is the standard pattern above rung 1.
8. Service terms are disclosed to the user, who decides — except where a capability would place the
   user's credentials or live session on third-party infrastructure, which is refused.
9. Every intake names its port, its plan step, and what it retires. Failing any is rejection.
10. Attribution is generated, not maintained.

## 11. Open questions

- Whether `licenseProfile` blocks publication on day one or warns during a backfill period
- Who holds the counsel relationship for the escalations rung 1 and 2 will generate
- Whether data-rights attribution belongs in the generated NOTICE or a separate SOURCES artifact,
  since data attribution often must appear in the UI rather than in a file
- Whether a Pattern Skill needs a provenance field naming the source it was learned from, which aids
  honesty and audit but may itself carry trademark risk
