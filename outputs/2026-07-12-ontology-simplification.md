# Session output — Ontology simplification decided (2026-07-12)

## Outcome

Full concept/architecture simplification decided and applied to canon (ADR-049 +
ADR-050). ~30% concept reduction, zero governance/security capability lost.

## Decisions landed

1. **Terminology canon (ADR-049)**: Package→Module · Ritual→Automation ·
   Signal/Incident→Event · Compiled Workspace/Product retired (DealPilot,
   JobPilot = Modules).
2. **Simplification with user amendments (ADR-050)**:
   - Work chain: **Request → Plan → Decision → Run → Action(s) → Event(s) →
     Result** — Request-into-Action merge rejected (intent ≠ execution).
   - **Workspace dropped as primitive** → Organization / Module / ElementType /
     Element / View. Home = distinguished View, not a primitive. Blueprint =
     Organization composition definition.
   - **Invariants vs defaults**: governance contract, bounded attributable DAG,
     agent floor + one governance authority, Plane Gate, lethal trifecta,
     recorded reviewMode = invariants. 4-agent roster, star topology,
     Planner/Run split = default compositions.
   - **reviewMode** `auto|notify|approve|quorum` replaces L0–L3; computed by
     broad resolve(), never configured; resolution immutably recorded.
   - Events **residency-partitioned**; **Timeline = projection** over the logs.
   - **Relationship Domain / Work Domain** replace Mirror/Operational planes;
     Plane reserved for Local/Cloud residency.
   - Manifest 3→1 · Memory+Knowledge→Context · CapabilityState 7→4 ·
     ModuleVersionState 6→3 · initiatives→ElementType (direction).

## Artifacts

- [docs/wiki/ontology.md](../docs/wiki/ontology.md) — rewritten canonical taxonomy
- [docs/raw/simplification-proposal-2026-07-12.md](../docs/raw/simplification-proposal-2026-07-12.md) — proposal + per-item resolution
- [docs/raw/requirement-simplification-directives-2026-07-12.md](../docs/raw/requirement-simplification-directives-2026-07-12.md) — verbatim user directive
- [docs/raw/decisions-log.md](../docs/raw/decisions-log.md) — ADR-049, ADR-050
- Glossary artifact (claude.ai): https://claude.ai/code/artifact/a35a7f24-4116-483e-9450-878957e669fb — v4; needs v5 refresh to match ADR-050

## Staged migrations (direction locked, not built)

workspace_id→organization_id (RLS + all tables) · ritual_runs→automation_runs ·
package_installations→module_installations · timeline_entries→events projection ·
initiatives→seeded ElementType · state-enum collapses · L0–L3→recorded
reviewMode resolutions.
