# Universal Commons

Commons = signed registry of generalized Modules, Blueprints, Skills, Integrations, templates, and reusable capability patterns. Never personal/Organization data. Separate from Cloud Plane and Bridge Cloud.

- Service: `platform/services/commons`; storage behind `CommonsStore`; HTTP client behind `CommonsRegistry`.
- Registry Entry immutable by name/version/content hash. Publisher signature + origin + manifest + compatibility + security/evaluation evidence.
- Publish privacy gate scans raw payload before parse. Reject personal IDs, emails, secrets, tokens, Field values, raw captures, Organization-specific content; return exact offending paths.
- Marketplace = optional website discovery surface. App consumes installed Modules only. Install still passes signature, dependency, risk, lethal-trifecta, authority, and approval checks.
- Registry starts honest/empty. Built-ins publish as generalized signed entries. No personal Memory.
- CM0 wire client/API consumption. CM1 signature/hash/publisher/security scan before corpus ingest.
