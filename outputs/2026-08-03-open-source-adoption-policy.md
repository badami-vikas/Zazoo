# Open-Source Adoption Policy — analysis, validation, and proposed final form

2026-08-03. Tier C decision record. Ratifying this means promoting it to `docs/raw/` with a wiki
companion, an ADR in `docs/raw/decisions-log.md`, and an `docs/APPROVALS.md` row — it is not policy
until then.

## 1. What the proposed five-tier plan gets right

The tier model (permissive · weak copyleft · strong copyleft · network copyleft · commercial/restricted)
is correct on the law and correct on the commercial instinct. Three parts are load-bearing and should
survive into the final policy unchanged:

- **Obligations trigger on distribution and network use, not on adoption.** This is the single most
  important idea in the plan. It is why "we use AGPL software internally" and "we host AGPL software
  for customers" are different decisions.
- **Separate spec from implementation (§B).** Ship the workflow — agent behavior, prompts, guardrails,
  evals, integration wiring, deployment instructions — and let the customer choose the implementation.
  This is the highest-value idea in the document, and Bridge is already architected for it (see §4).
- **Policy gate before publish (§C).** A capability should not reach a customer without someone having
  answered "who hosts it, who distributes it, what notices are owed."

## 2. What validation against JobPilot and DealPilot revealed

Applying the plan to the two Modules it was meant to validate against produces an almost empty result.

**JobPilot** (`platform/modules/jobpilot/package.json`) — every dependency is `workspace:*` except
`zod` (MIT). **DealPilot** (`platform/modules/dealpilot/package.json`) — every dependency is
`workspace:*` except `@napi-rs/keyring` (MIT).

Two Modules, two permissive third-party packages, zero copyleft, zero restricted. If the policy were
only the five tiers, it would classify both as "permissive, ship it" and be *technically correct while
missing every real obligation these Modules actually carry.*

Because the exposure is not in the npm tree. It is here:

| Real exposure | Where it lives | Which tier catches it |
|---|---|---|
| Google Workspace API terms | DealPilot via `@bridge/integrations-google` | **none** — a ToS, not a license |
| ATS portal terms (Greenhouse, Lever) | JobPilot sourcing | **none** — a ToS |
| LinkedIn prohibition on automated reads | Relationship / recon capture | **none** — a ToS, and it forbids what no license would |
| OFAC SDN, WhatsMyName, OpenAlex data terms | recon connectors | **none** — data rights ≠ code rights |
| CloakBrowser: MIT wrapper, separately-licensed binary needing OEM to distribute | proposed reader adapter | **misclassified** — a single license field reads "MIT" and is wrong |
| WUPHF Sustainable Use License | reference-only | tier 5, correctly |
| Model provider output terms | every `ModelProvider` call | **none** |
| Patent grant present in Apache-2.0, absent in MIT | any resold capability | **none** — tier 1 merges them |

**Conclusion: the five tiers are necessary and insufficient.** They describe rights in *code Bridge
redistributes*, and Bridge redistributes very little code. Bridge's actual product is orchestration
over services and data, where the binding terms are contracts and data licenses, not code licenses.

## 3. Proposed correction — an obligation vector, not a single tier

Replace the single `license_family` field with a vector. A capability's obligations are the **union**
of what each axis imposes, evaluated against the **deployment shape**.

**Axis 1 — Code license.** The five tiers, unchanged, plus one split the plan is missing:
`wrapper_license` and `payload_license` recorded separately. CloakBrowser is MIT + proprietary binary;
Firecrawl is AGPL engine + MIT SDKs. Collapsing these to one value produces a wrong answer in both
directions.

**Axis 2 — Patent grant.** `explicit` (Apache-2.0, MPL-2.0) · `absent` (MIT, BSD) · `retaliation_clause`.
Matters the moment a capability is resold rather than used.

**Axis 3 — Service terms.** For anything reached over a network: `automation_permitted`,
`rate_or_volume_limits`, `resale_permitted`, `account_binding` (does each customer need their own
credential?). This axis is where JobPilot's and DealPilot's real obligations live.

**Axis 4 — Data rights.** Separate from code. `attribution_required`, `share_alike`, `commercial_use`,
`redistribution_of_derived_records`. Recon's README already tracks this per-source informally; this
axis makes it structured.

**Axis 5 — Model/output terms.** Whether provider terms restrict using outputs to train or compete.

**Deployment shape** — the multiplier, and the thing that actually decides:

| Shape | What it means |
|---|---|
| `internal_only` | Bridge or the customer runs it, no third party touches it |
| `customer_hosted` | Customer operates it on their own infrastructure and credentials |
| `bridge_hosted` | Bridge operates it and serves customers — triggers AGPL §13, triggers OEM clauses |
| `distributed` | Ships to the customer as an artifact — triggers GPL source obligations, notice duties |

The rule that follows: **obligations are computed, not assigned.** `AGPL × internal_only` is fine.
`AGPL × bridge_hosted` requires source disclosure to every user of that server. `MIT-wrapper +
proprietary-payload × distributed` requires an OEM license. A reviewer should never have to remember
this — the manifest should compute it.

## 4. The structural advantage Bridge already has

The plan's §B ("separate spec from implementation") is not a new discipline Bridge must adopt. It is
what the codebase already does, and the policy should name it as the primary compliance strategy
rather than a fallback.

Bridge is built on ports and adapters: `ModelProvider`, `MemoryStore`, `SearchProvider`,
`ResearchPageReader`, `SourceConnector`, `ContentGuard`. The covered implementation sits *behind* a
port. Bridge ships the port, the contract, the guardrails, the evals, and the wiring — all
Bridge-owned. The customer supplies the implementation, or selects one whose terms fit their shape.

This converts most license questions from "may we redistribute this?" to "does the customer's chosen
adapter satisfy their own obligations?" — a question the customer is entitled to answer and Bridge is
not obliged to.

**Policy consequence:** a capability that cannot be expressed as port + adapter is a compliance
liability by construction, and that is a design review finding, not a legal one.

## 5. Where the policy should live — extend, do not parallel

The plan proposes storing a license profile per capability. Bridge already has the seam:

- `platform/packages/capability-kit/src/intake.ts` is the reuse-intake seam
- Module manifests already carry `capabilities[]` with `dataScope` and `egress` flags
- `CLAUDE.md` already mandates reuse intake and the clean-room protocol
- The learning roadmap's `reuse_policy` already declares
  `gates: [pinned_commit, license, transitive_dependencies, security_and_prompt_injection, provenance, contract_and_eval_conformance]`

So `license` is **already a declared gate that was never implemented.** The obligation vector belongs
on the existing manifest as a `licenseProfile` block, not in a new registry. A parallel compliance
registry would be exactly the kind of digression this codebase keeps accumulating.

## 6. Make the gate mechanical

A human review gate that runs on judgment will be skipped under deadline. Three of the four questions
in §C are mechanically decidable:

- **Manifest completeness check.** A capability with a network dependency and no `service_terms` axis
  fails the build. Unknown fails closed, matching the taint lattice's existing rule.
- **NOTICE generation.** Attribution is generated from manifests at package time, never hand-maintained.
  Apache-2.0 §4 compliance becomes a build artifact.
- **Shape assertion.** The manifest declares intended deployment shapes; CI fails if a capability marked
  `bridge_hosted` has an AGPL or restricted payload without an APPROVALS row.

Only the fourth — "is this specific commercial term acceptable" — needs a human, and it should stop for
counsel, consistent with CLAUDE.md's existing rule on ambiguous commercial cases.

## 7. Proposed final policy

1. **Every capability carries a `licenseProfile`** on its existing manifest: five axes plus declared
   deployment shapes. Absent or unknown fails closed.
2. **Obligations are computed** from `axes × shape`, never assigned by hand.
3. **Port-and-adapter is the default compliance strategy.** Bridge ships the contract; the customer
   supplies or selects the implementation. A capability that cannot be split this way is a design
   finding.
4. **Wrapper and payload licenses are recorded separately.** Never collapsed.
5. **Service terms and data rights are first-class axes**, because that is where Bridge's actual
   exposure is — proven by JobPilot and DealPilot carrying two MIT packages and a great deal of ToS.
6. **Attribution is generated, not maintained.**
7. **CI enforces the mechanical gates**; only genuine commercial-term questions reach a human, and
   ambiguity stops for counsel.
8. **Bridge never hosts network-copyleft or restricted payloads** without an explicit APPROVALS row
   naming the operating model that was reviewed.
9. **Bring-your-own-license/install** is the standard pattern for tier 5, with the customer's
   entitlement connected at runtime, never bundled.

## 8. Immediate applications

- **CloakBrowser** — wrapper MIT, payload proprietary, `bridge_hosted` and `distributed` both blocked
  without OEM. Permitted shape: `customer_hosted` or `internal_only`. Matches the constraint already
  recorded in the unified Learning capability spec.
- **Context.dev** — hosted service, so axis 3 governs: account-bound, per-customer credential, no
  resale of raw results. Adopt as `customer_hosted` credential with Bridge supplying the adapter.
- **WUPHF** — Sustainable Use License bars `bridge_hosted` serving of third parties. Reference-only
  stands; its patterns are ideas, and ideas are not covered by its license.
- **Firecrawl** — the split axis resolves the roadmap's open question mechanically: AGPL engine cannot
  be `bridge_hosted`; MIT SDK can. This is the answer the roadmap reached by argument; the policy now
  reaches it by construction.

## 9. Open questions

- Whether `licenseProfile` blocks the build on day one or warns for a grace period while existing
  manifests are backfilled
- Who holds the counsel relationship for the commercial-term escalations this policy will generate
- Whether data-rights attribution belongs in the generated NOTICE or a separate SOURCES artifact,
  since data attribution often must appear in the UI rather than in a file
