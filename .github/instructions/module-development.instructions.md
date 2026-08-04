---
applyTo: "platform/apps/api/src/built-in-packages.ts,platform/apps/api/src/router.ts,platform/packages/core/src/package/**,platform/tools/*/bridge.package.yaml,platform/tools/*/src/manifest.ts,platform/apps/web/src/app/pages/ModuleDetailPage.tsx"
---

# Module development

- Read `CLAUDE.md` first. It is the only canonical instruction source; this file is a path-scoped pointer, not a second design authority.
- Read `docs/wiki/packages.md`, `docs/wiki/ui-architecture.md`, and the matching Module wiki/plan before changing a Module.
- Extend the manifest-driven Module contract. Do not invent a parallel inventory, route catalog, storage model, approval path, or per-Module UI grammar.
- Reuse Engine ports and shared packages. Module code owns domain behavior, not copies of sourcing, dedupe, facts, tables, governance, identity, or persistence machinery.
- Keep runtime surfaces on real connected data or honest empty states. Follow `docs/glossary.md`; legacy `PackageManifest`, `workspace_definition`, and `workflow` code names are migration debt, not patterns to spread.
- Calendar is a View kind and Google Calendar is an Integration. Never recreate Calendar as a Module, Tool, dedicated product route, or nav identity.

## Current manifest contract

- Author the installable manifest through `parsePackageManifest()`. The repository still uses the migration filename `bridge.package.yaml`; never use `package.yaml` because pnpm treats it as a project manifest, and do not introduce another manifest format.
- Use a kebab-case Module name, exact semver versions and exact dependency pins. Capability IDs are unique. A non-blueprint Module contains at least one capability.
- A Module surface binds Pages to declared `view` capabilities, Agents to declared `agent` capabilities, Agent `skillIds` to declared `skill` capabilities, and Automations to declared `workflow` capabilities plus a declared Module Agent. Routes start with `/`.
- Skills remain nested under consuming Agents. Only an attributable allowed Agent invokes a Skill; an Automation starts an Agent Run. `ritualId` and runtime-Agent ID mappings must resolve through the built-in runtime bridge rather than browser input.
- `commonsNeeds` describes a real capability gap. It is not an inventory of already installed capabilities or a way to fabricate cards.

## Registration, trust, and lifecycle

- Register built-ins in `BUILT_IN_PACKAGES` from parsed manifests and keep source-ref/runtime-ID mappings beside that registry. When editing a Module-specific block in the monolithic API router, also read that Module's path-scoped instruction file.
- Parse and reject invalid manifests at the API boundary; do not pass raw manifest objects deeper or repair invalid input silently.
- Compute install risk over bundled capabilities plus the full dependency closure. The union of private read, untrusted ingest, and egress escalates the whole Module to `external`; manifest prose or a per-capability low-risk label cannot lower it.
- Preserve the single-live-version lifecycle: promotion demotes the previous available version to legacy; rollback forks a new draft from history and still follows normal approval. Never mutate history in place.
- Keep Module Detail metadata-driven: Overview, Pages/Databases, Agents with nested Skills, Automations/Runs, Integrations, Files/Results, and Settings render from the installed manifest and stores. Empty sections stay honest.

## Validation

- Add or update parser tests for every manifest rule, risk tests for dependency/trifecta changes, lifecycle tests for promotion/rollback, API tests for registration/install behavior, and Module Detail tests for surface bindings.
- Validate the changed Module package plus affected core/API/web/db neighbors and the falsifiable Prototype test in `docs/TASKS.md`.
