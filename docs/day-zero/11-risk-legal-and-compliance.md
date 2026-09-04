# Risk, legal, and compliance

## Material risk register

| Risk | Trigger | Treatment | Launch gate | Owner |
|---|---|---|---|---|
| Authority bypass | Action executes after denial or without correct actor | Suspend capability, fix server-side authorization, regression suite | Zero known critical bypass | Security |
| Private-data egress | Local/private context reaches network without Decision | Plane Gate, taint join, quarantine, incident process | End-to-end egress proof | Security + Architecture |
| Commons supply-chain compromise | Bad signature, key loss, malicious dependency | Content pinning, key custody, sandbox, revoke | Curated publishers only | Commons owner |
| Prompt injection | External content influences privileged Action | Runtime taint, typed extraction, approval warning | High-risk paths fail closed | AI Security |
| Cross-tenant access | User sees another Organization’s data | RLS, app checks, isolation tests | Multi-tenant proof before GA | Data owner |
| Credential compromise | Raw secret exposed to model, log, or wrong user | Broker, secret store, re-auth, rotation | Reveal/revoke/wrong-user tests | Security |
| Model/provider cost spike | Runaway usage or provider pricing change | Budgets, tier routing, cache, kill switch | Per-Run and per-Org caps | AI Platform |
| Hallucinated or weak evidence | User acts on unsupported Result | citations, fact/inference separation, evals | Workflow-specific quality floor | Product |
| Capture surprise | User does not understand sensing | visible tell, Local capture, pause, inspect | Zero unresolved surprise | Product Design |
| IP/license violation | Restricted source enters product or Commons | reuse intake, provenance, counsel gate | Complete notices and review | Legal |
| Over-customization | Each pilot becomes bespoke code | Module grammar, change control, reuse metric | No unowned customer forks | Product |
| Platform overclaim | One workflow presented as universal proof | two-Module proof strategy | Claims match evidence | Founder |
| Availability failure | Free or single-region services sleep/fail | pilot disclosure, restart tests, later paid topology | Accepted pilot limitation | Operations |
| Desktop distribution failure | unsigned/unnotarized or update break | signing, notarization, release channel | Signed pilot build | Desktop owner |
| Compliance misrepresentation | Marketing claims audit or certification not held | claim review and contract language | Counsel-approved claims | Founder + Legal |

## Required legal documents before external pilot

- Pilot agreement or order form.
- Master services agreement appropriate to the engagement.
- Privacy notice.
- Data processing addendum.
- Security exhibit.
- Acceptable use policy.
- AI and automation disclosure.
- Subprocessor list.
- Open-source and third-party notices.
- Support and availability statement.
- Data return/deletion terms.
- Confidentiality and intellectual-property terms.
- Design-partner feedback and case-study permission terms.

For general availability, add finalized Terms of Service, commercial SLA where offered, cookie/analytics notice, billing/refund policy, and regional privacy rights process.

## Intellectual property policy

- Record authorship and source provenance.
- Keep customer data and confidential workflow details out of shared packages.
- Respect code, content, dataset, model, and trademark rights separately.
- Treat no-license repositories as unavailable for copying.
- Preserve required notices.
- Use contributor and publisher agreements before third-party Commons publication.
- Obtain counsel review for commercially material ambiguity.

## AI disclosures

Users must know:

- when a model materially generated or transformed output;
- which provider category processed the request;
- whether processing was Local or Cloud;
- which sources influenced the Result;
- that model output may be wrong;
- how to correct, appeal, or stop consequential work.

## Sector boundaries

At launch, Bridge should not claim to provide legal, medical, tax, investment, employment, or other regulated professional advice. Modules may organize evidence and draft work, but qualified Humans remain responsible where law, contract, or professional standards require them.

DealPilot must distinguish research and workflow support from investment advice. JobPilot must avoid discriminatory inference, fabricated candidate claims, and access-term violations. Relationship features must avoid covert profiling and unlawful enrichment.

## Privacy compliance preparation

Before choosing specific compliance claims:

- map data categories, purposes, systems, locations, processors, and retention;
- identify controller/processor roles per workflow;
- establish access, correction, deletion, portability, and objection procedures;
- document international transfers;
- assess children and sensitive-data exclusions;
- perform risk assessments for systematic monitoring or high-risk automated decisions;
- establish breach assessment and notification workflow.

Jurisdiction-specific conclusions require counsel.

## Compliance roadmap

### Pilot

Truthful policies, signed contracts, access controls, incident process, vendor inventory, data map, and security evidence.

### Paid production

Formal risk management, annual penetration test, vulnerability process, security training, backup/restore evidence, change management, and customer security package.

### Enterprise

Pursue SOC 2 or equivalent only when the target customers demand it and operating controls are stable. Certification should reflect real practice, not become a substitute for product-market fit.

