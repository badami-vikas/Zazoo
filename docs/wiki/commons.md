# Universal Commons

Commons = registry of GENERALIZED capability knowledge. NEVER user data. v1 = curated Module registry (Module = user-facing word for installable package; code types stay `PackageManifest`).

## Shape (R-004, ADR-028)
- **Local-first service**: `platform/services/commons` — Fastify 5, port 4780. Same HTTP contract as future "Bridge Cloud" hosted registry. Lift to cloud = deploy same contract + point `COMMONS_URL` at it. Config-only swap.
- **Storage**: local FS JSON (`COMMONS_DATA_DIR`, default `.commons-data/`, gitignored) behind small `CommonsStore` port → cloud swaps Postgres in, routes untouched. No new DB dep.
- **Marketplace = Commons WEBSITE surface.** Module discovery/browse lives on the website, reads this registry API. Web app does NOT get a marketplace UI — it only consumes INSTALLED Modules.

## Contract (permanent, v1)
```yaml
GET  /health: { ok, service, packages }
GET  /v1/packages: list; filters kind, tag; limit/offset pagination
GET  /v1/packages/:name: latest entry + version history
GET  /v1/packages/:name/:version: one full published entry (manifest inside)
POST /v1/packages: publish { manifest, tags? } -> 201
  400 invalid_manifest (parsePackageManifest, @bridge/core)
  409 duplicate_version (published versions immutable)
  422 workspace_data_rejected + offendingPaths[]  # knowledge-only gate
```

## Knowledge-only rule — ENFORCED IN CODE
Publish gate (`services/commons/src/privacy-gate.ts`) walks RAW payload before parsing. Denied keys (any depth, any casing): workspaceId / userId / email / personId / ownerId / createdBy / tenantId / apiKey / tokens / secrets etc. Hit → 422 lists exact JSON paths. Manifest describes a capability, never an install.

## Consumer side
`CommonsRegistry` port + wire types in `@bridge/core` (package/commons.ts). Fetch adapter `HttpCommonsClient` in apps/api (`COMMONS_URL` env, default `http://localhost:4780`). listAvailable/get/getVersion/publish. NOT wired into web UI (see Marketplace rule above).

## Content
Registry starts EMPTY — no seed/dummy data. First honest content: `pnpm --filter @bridge/api publish-builtins` posts the four built-in workspace-definition manifests (deal-pilot, job-pilot, helpdesk, chief-of-staff) — generalized knowledge, allowed.

## Run
```yaml
start: pnpm --filter @bridge/commons build && pnpm --filter @bridge/commons start
env: { COMMONS_PORT: 4780, COMMONS_HOST: 127.0.0.1, COMMONS_DATA_DIR: .commons-data }
tests: pnpm --filter @bridge/commons test  # node:test, 5 tests (gate + HTTP roundtrip)
```
