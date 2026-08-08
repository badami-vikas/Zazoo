# AI Harness

Full: [raw/ai-harness-plan-2026-08-09.md](../raw/ai-harness-plan-2026-08-09.md) · ADR-210 · AP-131

One loop. Observe → distill → store (graph+memory+vectors) → retrieve → recommend → promote.
Ladder: preference → automation → skill → module. Human gate every rung.

North star: harness proposes DealPilot-shaped module from observation alone. Nobody tells it.

Phases → tasks: K0 spine TASK-044 · K1 ledger miner TASK-045 · K2 local stores TASK-046 ·
K3 knowledge substrate TASK-047 · K4 continuous context TASK-048 · K5 email/calendar TASK-049 ·
K6 morning brief TASK-050 · K7 app-focus TASK-051 · K8 browser TASK-052 · K9 builder ladder
TASK-053 · K10 hardening gate TASK-043 · K11 three senses TASK-054.

Rules that hold everywhere: capture = consent toggle, default off. Kill switch. Raw never leaves
Local Plane. Every capture = inspectable Memory + Avatar blink. Red claim classes never proposed.
Invasive senses (input/screen/audio) sit BEHIND K10 — guarantees become executable tests first.

KG stays Postgres. LangGraph rejected (wrong category). Graphiti ideas borrowed (bi-temporal
edges, invalidation not deletion), dependency not taken. Escape hatch: Kùzu as rebuildable index
if CTEs choke — truth never moves.

Unified-learning spec: folded in. This plan orders the work. Spec stays a design source, not a
queue.
