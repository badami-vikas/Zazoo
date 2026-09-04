# Governance, data, privacy, and security

## Trust proposition

Bridge asks for unusually deep context. Its right to exist depends on making control stronger than the convenience it offers. Governance is therefore product functionality, not a legal notice or an AI prompt.

## Authority model

Every consequential Action must answer:

- Which authenticated actor requested it?
- For which Organization and Module?
- What authority does that actor have?
- Which explicit denies apply?
- Which data may be read?
- Which systems may receive data?
- What approval band applies?
- What budget and time limit apply?
- What exact version and policy made the Decision?

Authority is deny-default. Agent authority cannot exceed the Human or delegation ceiling. Agent-floor denies protect governance changes, unrestricted egress, credential access, and other reserved actions.

## Decision bands

| Band | Typical work | Default launch treatment |
|---|---|---|
| Informational | Read, summarize, classify permitted data | May run under bounded policy |
| Advisory | Recommend or draft without changing source truth | May run with visible provenance and correction |
| Transformational | Modify internal work state | User preference or explicit approval |
| Operational | Run a recurring or consequential internal process | Governance review and bounded budget |
| External | Send, publish, purchase, submit, disclose, or alter an external system | Explicit Human approval |

Composite risk takes the highest risk across dependencies, data sensitivity, audience, and egress. A generated capability begins as a Draft; confidence never grants authority.

## Data classification

- Public: lawful public information with source and rights evidence.
- Organization internal: ordinary team work not intended for public release.
- Private: personal or sensitive work restricted to an authorized subset.
- Secret: credentials, keys, recovery material, or equivalent.
- Restricted: information governed by contract, law, privilege, or special policy.

Classification travels with provenance and runtime taint. Unknown or malformed labels fail closed.

## Residency

### Local Plane

Customer-controlled location for private capture, local inference, local credentials, and data that has not been approved to leave.

### Cloud Plane

Authorized hosted residency and execution for data explicitly permitted there.

### Plane Gate

The sole Local-to-network or cross-residency decision boundary. It joins all relevant context, not merely the final message, when evaluating egress.

### Commons

Generalized capability packages only. No personal or Organization-specific data.

### Bridge Cloud

Hosted identity, synchronization coordination, billing, and policy-controlled telemetry. It must not inherit Commons’ no-user-data claim or silently become a private-data sink.

## Privacy requirements

- Collect the minimum information needed for a declared outcome.
- Request permission at the time of use.
- Keep raw capture Local.
- Retain source, purpose, scope, and expiration.
- Allow inspect, correction, export, and deletion where permitted.
- Avoid dark patterns when consent is declined.
- Do not use customer private data to train shared models or Commons packages without a separate explicit agreement.
- Keep telemetry content-free by default; policy controls any richer diagnostics.
- Provide a clear subprocessors and model-provider list before a pilot.

## Runtime taint and prompt-injection controls

Untrusted external content is data, never operator instruction. It must:

- enter through classified source edges;
- retain provenance;
- be quarantined from authority-bearing contexts;
- pass typed extraction where privileged execution is possible;
- join into sink policy;
- produce an “influenced by untrusted content” warning on approvals;
- require deterministic validation or recorded Human Decision for declassification.

Models do not decide authority, risk bands, or declassification.

## Credential and integration security

- Store raw credentials only in approved secret storage.
- Give Agents opaque, scoped grants rather than raw secrets.
- Bind grants to Human, Organization, Integration, actions, data, and expiry.
- Re-authenticate for credential reveal or high-risk use.
- Log use without logging secret values.
- Support revoke, rotate, expire, wrong-user denial, and compromise response.

## Security release minimum

- Auth required in production and fail-closed configuration.
- Least-privilege runtime database role.
- Row-level and application-level Organization isolation.
- Explicit CORS and desktop content-security policy.
- Rate limiting and cost-abuse controls.
- Dependency and license scanning.
- Signed release artifacts where supported.
- Encrypted secrets and backups.
- Tested incident response, rollback, and audit access.
- No unresolved critical vulnerability.
- Named owner and due date for every accepted high risk.

## Incident priorities

- P0: confirmed data disclosure, credential compromise, authority bypass, destructive cross-tenant action, or supply-chain compromise. Suspend affected capability and access immediately.
- P1: exploitable security defect without confirmed loss, repeated policy bypass attempt, or serious availability failure.
- P2: bounded defect with workaround and no current evidence of compromise.
- P3: hardening or low-impact issue.

Security incidents preserve evidence, minimize further access, notify required parties, correct root causes, and produce an after-action review without exposing sensitive payloads.

