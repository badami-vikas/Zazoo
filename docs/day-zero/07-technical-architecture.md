# Technical architecture

## Architectural objective

One governed runtime should support many Modules and three clients without moving private data unnecessarily or allowing model output to become authority.

## Logical architecture

```text
Desktop / Web / Mobile
          |
       tRPC API
          |
Identity → Authority → Policy → Governed Pipeline → Ledger
                         |
          Agents → Skills → Integrations
                         |
        Engine ports and durable adapters
                         |
     Local Plane ← Plane Gate → Cloud Plane
                         |
              Commons / Bridge Cloud
```

## Current implementation shape

- TypeScript monorepo managed by pnpm and Turbo.
- React and Vite web client.
- Tauri desktop shell with Rust for native behavior and optional sensing.
- Fastify and tRPC API.
- Drizzle over Postgres/Supabase; local durable storage behind Local Plane adapters.
- Shared core package for authority, pipeline, capability, and execution rules.
- ModelProvider abstraction for local and approved cloud inference.
- Signed Commons service and registry client.
- Module manifests for built-in and installed functionality.

## Architectural invariants

1. Core domain logic is independent of UI framework and hosting provider.
2. Every mutation and egress uses the governed pipeline.
3. Server-derived identity and residency override client claims.
4. Private capture remains Local until the Plane Gate permits movement.
5. Agents invoke Skills; Automations start Agent Runs.
6. Credentials are resolved at execution edges and never placed in prompts.
7. Runtime taint propagates monotonically; missing labels quarantine.
8. Signed package history is immutable.
9. Clients are thin and share contract behavior.
10. Module-specific terms never become Engine primitives without an approved platform decision.

## Core data model

- Organization: tenancy, membership, policy, and billing boundary.
- Module: installed bundle of work surfaces and governed capabilities.
- Database and Record: structured Module data.
- Relation: typed connection with provenance, confidence, and validity.
- Event: append-only occurrence.
- Result: non-file output of a Run or Action.
- File: file-backed content with source and residency.
- Memory: retained, inspectable information associated with a Module.
- Agent, Skill, Integration, Automation: governed capability categories.
- Request, Plan, Decision, Run, Action: execution chain.

The graph is a shared projection over permitted Records, Relations, Events, Files, Agents, and Modules. It does not erase residency or authorization boundaries.

## Runtime sequence

1. Authenticated Request enters with Organization and client context.
2. Identity and residency are derived by trusted infrastructure.
3. Authority resolver applies roles, grants, delegation, and denies.
4. Policy computes risk, data scope, approval, and budget.
5. Prompt assembler selects only authorized, provenance-bearing context.
6. Agent chooses an allowed Skill or returns a proposal.
7. Approval occurs where required.
8. Skill executes through typed Integration or Engine ports.
9. Events, Results, Files, costs, and taint are recorded.
10. Post-policy determines completion, retry, suspension, or review.

## Deployment model

### Private pilot

- Hosted public-safe API and web surface.
- Supabase for verified identity and authorized hosted data.
- Desktop sidecar and Local Plane for private operational work.
- Commons deployed separately with durable signing material.
- Exact pilot allowlist until multi-user administration is certified.

### Later production

- Multi-tenant hosted control plane with tested tenant isolation.
- Regional strategy based on actual customer demand.
- Dedicated or self-hosted Local Plane options where justified.
- Separate operational domains and keys for Bridge Cloud and Commons.
- Mobile and signed desktop release channels.

## Reliability requirements

- Idempotency keys for external and replayable Actions.
- Durable Run and approval state.
- Lease, retry, cancellation, and terminal-state rules.
- Compare-and-swap or transaction guards for concurrent mutation.
- Health and readiness probes that include required dependencies.
- Backup, restore, and migration rehearsal.
- Feature and capability suspension without full-platform outage.
- Prompt-free replay for security and audit investigations.

## Observability

Record per Run:

- actor, Organization, Module, Agent, Skill, and versions;
- latency by stage;
- model identity and token use;
- cache use and estimated cost;
- data sources, residency, and egress;
- Decisions and policy version;
- retries and failure class;
- outcome, correction, and user feedback.

Logs must avoid raw private content and credentials. Product analytics should be derived from privacy-safe Events where possible.

## Evolution rules

- Add provider-specific behavior behind a port.
- Add Module behavior through manifests and shared primitives.
- Make breaking contract changes through versioned migration.
- Preserve signed and audit history.
- Reject shortcuts that bypass authority for demo convenience.
- Do not claim platform generality until multiple Modules prove reuse.

