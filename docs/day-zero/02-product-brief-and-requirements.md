# Product brief and requirements

## Product statement

Bridge is a governed adaptive work platform that assembles and evolves Modules around real user work across desktop, web, and mobile.

## Primary jobs to be done

1. Help me understand what matters now across my work.
2. Keep relevant context connected and findable without making me maintain another database.
3. Turn repeated work into a proposed, reviewable capability.
4. Let me delegate bounded work without losing control or provenance.
5. Help my team reuse proven ways of working without leaking private information.

## Core user types

- Individual professional: wants personal leverage, continuity, and reduced administrative work.
- Team operator: wants shared context, reliable handoffs, and governed execution.
- Team owner: wants control, auditability, policy, and measurable outcomes.
- Module publisher: wants to package a reusable generalized capability.
- Administrator: manages identity, residency, integrations, and policy.

At pilot stage, one person may occupy several roles.

## Product model

An Organization installs Modules. Each Module contains Databases, Pages, Views, Records, Relations, Files, Agents, Skills, Integrations, and Automations. The shared Engine supplies authority, policy, Memory, execution, evaluation, and audit.

The standard work chain is:

Request → Plan → Decision → Run → Action → Event → Result or File.

The Avatar presents status and interaction but does not hold independent authority. Commons distributes generalized, signed capability packages and never holds personal user data.

## Day-one product journey

1. User creates or activates an Organization.
2. Bridge explains residency, capture, inference, and action permissions.
3. User states role, outcomes, existing tools, and communication preferences.
4. Bridge proposes a minimal starting Module configuration.
5. User sees the Avatar and a clear first-value task.
6. Bridge connects or imports one real source with explicit permission.
7. Learning produces one cited recommendation.
8. User approves, edits, or vetoes the proposal.
9. A permitted Agent uses an installed Skill to complete bounded work.
10. User inspects provenance, corrects the outcome, and sees what was learned.

## Functional requirements

### Organization and identity

- Verified user identity for hosted access.
- Organization membership and role-based authority.
- Tenant isolation at application and database layers.
- Human identity must never be inferred from request payload alone.

### Modules and work surfaces

- Every installed Module appears as an actionable navigation item.
- Module Detail is generated from a versioned manifest.
- Shared View grammar supports Table, Board, Calendar, Gallery/Card, Form, Timeline, Graph, and Map where data is eligible.
- Records, Relations, Events, Results, and Files retain source Module and provenance.
- Empty states are honest; runtime dummy data is prohibited.

### Agents, Skills, Integrations, and Automations

- Only an attributable Agent may invoke a Skill.
- Skills declare input, output, data access, egress, and failure behavior.
- Integrations use scoped credentials through a broker; raw secrets never enter model context.
- Automations start Agent Runs rather than acting as hidden free-standing authority.
- Every Run has an owner, version, context boundary, cost record, and terminal result.

### Governance

- Every mutation or egress resolves authority and policy.
- Consequential work presents an understandable approval card.
- Human may approve, edit, veto, pause, revoke, or correct within policy.
- Agent-floor denies cannot be removed by a Module or prompt.
- Failure can suspend a capability immediately.
- Audit history is append-only and inspectable.

### Memory and learning

- Every retained learning is associated with a Module and source evidence.
- User can inspect, correct, export, and delete retained preferences subject to audit obligations.
- Untrusted external content remains data, never authority-bearing instruction.
- Suggested learning becomes retained learning only under declared policy.
- Generalization to Commons removes personal and Organization-specific data.

### Avatar and capture

- Avatar states are operational: idle, working, awaiting approval, blocked, and error.
- Capture produces a visible tell and an inspectable Local Plane Memory entry.
- Denying capture permissions does not make the rest of Bridge unusable.
- Desktop Avatar remains movable, accessible, and persistent across supported display changes.
- Visual character choice never changes Agent authority or behavior.

### Commons

- Registry entries are versioned, content-addressed, signed, scanned, and provenance-bearing.
- Install verifies publisher trust, content hash, compatibility, dependency closure, permissions, and current Module need.
- Tampered, unknown, or privacy-violating packages fail closed.
- Publication is approval-gated and must pass a privacy gate.
- Exact package and Agent provenance remains attached to every Run.

### Clients

- Desktop is the deepest client and owns optional sensing.
- Web provides reach and hosted public-safe surfaces.
- Mobile initially supports accessible review, approvals, essential records, and status.
- Core business behavior lives behind shared contracts, not in one client.

## Quality attributes

- Trustworthy: explicit permissions, clear explanations, no hidden authority.
- Private: Local by default for private capture and secrets.
- Resilient: restart-safe, idempotent, observable, and recoverable.
- Accessible: keyboard, screen reader, reduced motion, touch, and responsive layouts.
- Portable: replaceable infrastructure behind stable ports.
- Auditable: decisions, inputs, versions, Actions, and outcomes can be reconstructed.
- Economical: model, storage, egress, and support cost visible per useful outcome.

## Initial release acceptance

Bridge is ready for a private pilot only when one fresh user can complete the full journey with real data, the same journey can be repeated by the product team, all consequential actions remain governed, rollback works, support ownership is named, and no critical security or privacy issue remains.

Bridge is not ready for public self-serve while pilot-only identity assumptions, external credential gates, cross-platform blockers, unclear pricing, or unowned incidents remain.

## Explicit exclusions from the first pilot

- Unknown third-party Commons publishers.
- Automatic external email sending.
- Automatic financial commitments.
- Broad browser history collection.
- Always-on microphone capture.
- Unsandboxed user code.
- Multi-region availability promises.
- Regulated-sector claims beyond signed pilot terms.

