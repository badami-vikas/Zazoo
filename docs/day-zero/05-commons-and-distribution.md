# Commons and distribution

## Purpose

Commons is Bridge’s signed registry for generalized reusable capabilities. It enables a useful practice proven in one setting to become an installable Module, Skill, Integration adapter, Blueprint, template, or governance pattern without moving personal data.

Commons is not:

- the Cloud Plane;
- Bridge Cloud;
- a user Memory store;
- a place for customer Files, Records, prompts, emails, or raw captures;
- an unrestricted code marketplace.

## Registry entry contract

Every entry must include:

- stable package identity and semantic version;
- immutable content hash;
- publisher identity and signature;
- source and license provenance;
- compatibility range;
- declared components and dependencies;
- permissions, data scopes, egress, and credential needs;
- risk computation inputs;
- security scan results;
- evaluation evidence;
- install, upgrade, rollback, and uninstall instructions;
- privacy-gate result;
- deprecation and support status.

## Publication lifecycle

1. Need is observed in private work.
2. Generalizable behavior is separated from customer data.
3. Publisher creates a clean package and provenance record.
4. Privacy gate rejects personal, secret, Organization-specific, and restricted material.
5. License and supply-chain checks run.
6. Security and evaluation checks run in isolation.
7. Human reviews the exact content hash and evidence.
8. Publisher signs the accepted bytes.
9. Commons records the immutable version.
10. Later changes create a new version; they never rewrite the signed version.

## Installation lifecycle

1. A real Module or user need initiates search.
2. Bridge shows outcome, publisher, permissions, data use, cost, compatibility, evidence, and alternatives.
3. Exact bytes are retrieved and hash/signature verified.
4. Dependencies are resolved and composite risk computed.
5. Current Module need and Agent ownership are revalidated.
6. Required Human Decision is recorded.
7. Package is installed and pinned.
8. Every Run records exact package, Module, and Agent provenance.
9. Registry, key, manifest, or trust drift blocks new Runs until reviewed.

## Publisher model

### Phase 1: Bridge-curated

Only Bridge-owned and explicitly reviewed partner packages. Manual approval is acceptable. Goal: prove contracts and recovery.

### Phase 2: invited publishers

Verified publishers, test conformance, support expectations, automated scanning, revocation, and clear commercial terms.

### Phase 3: broader ecosystem

Only after abuse operations, trust scoring, dispute handling, vulnerability response, and customer controls are proven.

## Safety controls

- Signature verification and trusted-key management.
- Content-addressed pinning.
- Dependency closure and origin-risk floor.
- Privacy scanning plus Human review.
- Malware, secret, and license scanning.
- Runtime sandbox for executable logic.
- Network off by default.
- Credential broker; no raw secrets in packages.
- Revocation and emergency suspension.
- Reproducible build or provenance evidence where feasible.
- Publisher incident contact and response time.

## Rights and clean-room rules

Public visibility does not equal permission. For every source, record:

- exact source and version;
- code and content license;
- artifact and dataset rights;
- trademarks and distinctive UI risks;
- transitive dependencies;
- whether reuse, adaptation, interface compatibility, or only functional research is permitted.

Restricted code, prompts, prose, templates, datasets, or visual identity must not be copied or lightly paraphrased. A HeyClicky-like outcome may inspire the high-level requirement “friendly summonable desktop companion,” but Bridge must independently author implementation and visual identity.

## Marketplace experience

Discovery should lead with outcomes, not component jargon:

- “Prepare a cited company-culture brief.”
- “Turn a meeting follow-up into accountable tasks.”
- “Discover acquisition targets matching a thesis.”

The install screen then reveals publisher, version, permissions, residency, cost, evidence, known limitations, and support.

## Business model hypotheses

Commons may support:

- included Bridge-curated capabilities;
- paid certified Modules;
- publisher revenue share;
- private Organization registries;
- enterprise policy and approved catalogs;
- support and assurance tiers.

Do not charge a transaction fee before the ecosystem creates real value. Early revenue should come from the Bridge product and implementation partnership, not speculative marketplace activity.

## Success measures

- Search-to-install conversion for real needs.
- Install completion without support.
- Signature/privacy/compatibility rejection rates.
- Runs per installed capability.
- Correction, suspension, rollback, and uninstall rates.
- Time from repeated private need to approved generalized package.
- Zero confirmed personal-data publication incidents.
- Percentage of new needs satisfied by safe reuse instead of new code.

