# TASK-010 live certification

TASK-010 is complete. Authenticated persistent Local Plane testing found and fixed one final
same-surface gap: JobPilot's default table now exposes the shared Red Flag control for Role,
Company, and Stage through one batched provider and real application Record anchors.

The exact Prototype test passed at 1280×720 and emulated 375×812. Keyboard focus, pointer hover,
and coarse-pointer touch revealed the control; a real BCG application cell and rendered bullet were
flagged, given scoped reasons, cleared reversibly, and inspected in Settings > Learning audit
history. No green/yellow feedback semantics rendered.

Files: [JobPilotPage.tsx](../platform/apps/web/src/app/pages/JobPilotPage.tsx),
[Red Flag regression](../platform/apps/web/test/red-flag-control.test.mjs),
[TASKS](../docs/TASKS.md), and [BUGS](../docs/BUGS.md).
