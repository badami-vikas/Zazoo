# Universal Commons

Commons = signed registry of generalized Modules, Blueprints, Skills, Integrations, templates, and reusable capability patterns. Never personal/Organization data. Separate from Cloud Plane and Bridge Cloud.

- Service: `platform/services/commons`; storage behind `CommonsStore`; HTTP client behind `CommonsRegistry`.
- Registry Entry immutable by name/version/content hash. Publisher signature + origin + manifest + compatibility + security/evaluation evidence.
- Publish privacy gate scans raw payload before parse. Reject personal IDs, emails, secrets, tokens, Field values, raw captures, Organization-specific content; return exact offending paths.
- Marketplace = optional website discovery surface. App consumes installed Modules only. Install still passes signature, dependency, risk, lethal-trifecta, authority, and approval checks.
- Registry starts honest/empty. Built-ins publish as generalized signed entries. No personal Memory.
- CM0 wire client/API consumption. CM1 signature/hash/publisher/security scan before corpus ingest.
- Content hash: canonical manifest + provenance + scan. No hash recursion.
- Provenance: six closed fields. Extra trust metadata rejected.
- Signature: Ed25519 only. Binds hash + publish time. “Latest” cannot be timestamp-tampered.
- Publish: authenticated. Registry key persistent. Client trust key explicitly pinned. No TOFU.
- Blueprint executable refs: exact signed pins or reject.
- Shared deployment: TLS.
- Scan: deterministic dependency closure. Every dependency gets exact content hash. Unresolved/substituted dependency fails. Signed scan risk is install floor.
- Install: Module need → inspect → governed install → owning Agent. Skill never becomes top-level Module.
- Manual risk: one stable Human-review proposal. Never auto-applies.
- Approval: recheck root, dependencies, Module need, Agent, kind, tags. Then activate.
- Veto: package stays private. Failed activation: explicit + idempotent reconcile.
- Legacy exact install retries collapse with lineage preserved. Conflicting same-identity installs halt migration.
- Personal data/credentials rejected before storage. Runtime ownership metadata stays Local Plane.
- Automation owner: one stored Agent + Plane. Server derives actor. Ambiguous legacy ownership blocks.
- Legacy external/malformed/cross-workspace Automation stays unbound. Human must choose owner + Plane.
- Legacy Skill UUID allowlists migrate to procedure names. Missing/cross-workspace Skill aborts migration.
