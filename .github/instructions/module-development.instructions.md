---
applyTo: "platform/apps/api/src/built-in-packages.ts,platform/apps/api/src/router.ts,platform/packages/core/src/package/**,platform/tools/*/src/manifest.ts"
---

# Module development

- Read `CLAUDE.md` first. It is the only canonical instruction source; this file is a path-scoped pointer, not a second design authority.
- Read `docs/wiki/packages.md`, `docs/wiki/ui-architecture.md`, and the matching Module wiki/plan before changing a Module.
- Extend the manifest-driven Module contract. Do not invent a parallel inventory, route catalog, storage model, approval path, or per-Module UI grammar.
- A Module declares Pages/Databases, Agents with nested Skills, Automations, Integrations, Files, and Runs. Only an attributable allowed Agent invokes a Skill; an Automation starts an Agent Run.
- Reuse Engine ports and shared packages. Module code owns domain behavior, not copies of sourcing, dedupe, facts, tables, governance, identity, or persistence machinery.
- Keep runtime surfaces on real connected data or honest empty states. Follow `docs/glossary.md`; legacy `PackageManifest`, `workspace_definition`, and `workflow` code names are migration debt, not patterns to spread.
- Calendar is a View kind and Google Calendar is an Integration. Never recreate Calendar as a Module, Tool, dedicated product route, or nav identity.
- Validate the changed Module package plus affected API/web/db neighbors and its falsifiable Prototype test in `docs/TASKS.md`.
