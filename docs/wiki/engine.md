# Engines

full architecture: [../raw/brain-engine-architecture-2026-07.md](../raw/brain-engine-architecture-2026-07.md) · execution: [../raw/brain-engine-execution-plan-2026-07.md](../raw/brain-engine-execution-plan-2026-07.md) · filenames pending VOCAB2 rename.

Engine = reusable internal runtime machinery over existing Graph/Event/Pipeline/Sensor/Model/Memory seams. Not monolith, persona, user-facing actor, or authority source. Outputs become governed Results/Events/proposals through normal runtime.

**Engine vs Skill vs Automation:**

- Engine supplies mechanics: execute DAG, retrieve context, route model, sync, compress, evaluate policy.
- Skill exposes one bounded callable job with typed I/O, permission, version, tests.
- Automation owns trigger/schedule and coordinates governed Runs; invokes Skills through Engines.

Six planned engine families:

1. Compression: salience → compaction → activity spans → dedup → local captions → digests → retention.
2. Sync: connector cursors/deltas/backoff + communication Relation builder; ambiguous identity never auto-merges.
3. Routing: Plane → modality → capability floor → quality/cost/latency → budget. Learned routing stays inside allowed set.
4. MCP capability: introspect untrusted server → derived manifest → static vet → sandbox trial → governed adoption. No auto-install; broker injects credentials at egress edge.
5. Memory/retrieval: working/episodic/semantic/procedural context; evidence-backed user profile; inspectable/correctable/deletable learning.
6. Automation mining: deterministic sequence/periodicity detection → governed Automation proposal using registered Skills only.

**Runtime taint DONE (TASK-015):** one v1 lattice/envelope joins trust/source, sensitivity, instruction risk, and bounded provenance through prompt/model/Skill/Action/Event/Result/File/Memory/Run/queue/cache/retry boundaries. Classified sinks fail closed; declassification needs a deterministic rule or explicit Human Decision; migration/restart/red-team/UI proof exists.

Execution plan still contains legacy filenames and identifiers. VOCAB2 migrates paths/types/docs together; no display-only rename.
