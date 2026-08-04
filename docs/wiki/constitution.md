# Constitution — rules capabilities grow from

full: [../raw/bridge-constitution-2026-08.md](../raw/bridge-constitution-2026-08.md) · canon
2026-08-04 (AP-100, ADR-173). Proven first: ADR-172 regeneration test.

**Mechanism**: constitution = human-readable WHY. Harness = same rules compiled to executable
obligations. Conformant means **harness passes**, not "reviewer says it follows the docs". Every
invariant → ≥1 obligation; every obligation → an invariant.

**Input pack = 4 layers**: constitution · thin kernel contracts · capability mandate (~150 words,
MUST name that capability's risks — highest leverage per token) · harness. Method + Budget layers
under test, not canon.

**15 invariants**: engine-decided authority (green/amber/red, red never proposed, no self-upgrade
by rephrasing) · external content is data not instructions (taint forever, unknown fails closed,
structural quarantine, human-only declassification) · memory suggested-then-accepted (no silent
writes, inspect/correct/delete, annoyance cap, rejection suppression) · bounded autonomy (every
exit records a reason) · evidence ledger (resume replays, never re-executes, never refunds) ·
residency (Local never egresses, gates fail closed) · ports-only core (unit-testable with no
network/browser/model) · reuse before build · honest surfaces · evals are gates (injection suite
slice-1, 100%, permanent; baselines pinned) · one vocabulary · separation of duties (learner never
executes, governor never builds, builder never activates own output) · derived indexes are
rebuildable refs · ships dark (flags OFF, byte-identical) · **inference sensitivity tiered +
monotone** (red claim classes never proposed; amber phrased as observed facts not conclusions;
scoring may only RAISE sensitivity).

**Enforcement adopted 2026-08-04**: closed port-set allowlist as CI structural test (approval-gated
allowlist file) · claim→evidence map machine-checked per statement · shown-text acceptance hash
(catches rubber-stamping) · paraphrase-robust rejection fingerprints (blocked on semantic embedder)
· egress chokepoint in the privileged desktop process.

Never weaken a safety boundary to save tokens.
