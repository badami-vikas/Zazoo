# Bridge AI — Open-Source Stack & Study List

> From multi-agent research, licenses verified. **Permissive (embeddable):** MIT / Apache-2.0 / BSD / MPL-2.0 / ISC / PostgreSQL. **Do NOT embed:** AGPL / SSPL / BUSL / fair-code (study-only / wrap behind internal API).
> Companion: [STACK.md](./STACK.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

## Adopt now — by layer
| Layer | Pick | Why |
|---|---|---|
| Substrate / graph | **pgvector + pg_trgm** (PostgreSQL Lic) | Already in Supabase; zero new infra. Keep the `edges` table as v1 graph. |
| Graph traversal (later) | **Apache AGE** (Apache-2.0) | In-Postgres openCypher — the upgrade path without abandoning Postgres. |
| Embedding sync | **pgai Vectorizer + supabase/vecs** (PG Lic / MIT) | Declarative embedding sync for Phase 3 ingestion; less worker code. |
| Ritual engine | **Hatchet** (MIT, Postgres-native) | Closest OSS to the locked "thin orchestration on Postgres." Validate its schema vs RLS first. |
| HITL reference | **Trigger.dev** (Apache-2.0) · **LangGraph** `interrupt()`/checkpoint on AsyncPostgresSaver (MIT) | Reference impls of the User-Review gate on Postgres. |
| Tools / app-gen | **Refine** (MIT, headless) + **Dyad** (Apache-2.0, Supabase-native, auto-generates RLS) | Headless Tool surfaces + governance-respecting generation. |
| Agents | **BUILD thin runtime**; model on **Agno** scope schema (Apache-2.0) + LangGraph patterns | The runtime that enforces `capability_scope` is the moat — don't adopt a heavyweight framework as infra. |
| Skills | **MCP Python SDK** (MIT) + **FastMCP** (Apache-2.0) + **SKILL.md** spec | Adopt-direct: validate the contract maps onto `{name,version,input/output_schema,impl_ref}`. |
| Governance / authz | **BUILD** the Universal Action Pipeline; enforce with **RLS**; evaluate **OPA+OPAL** vs **Cedar** for the policy plane | The pipeline is the moat; the policy *language* is a buy-decision. |
| Ledger / observability | **BUILD** append-only ledger on Postgres (REVOKE UPDATE/DELETE), keyed to **OTel GenAI** conventions | System-of-record stays in-house; Langfuse/Opik only as sidecar viewers. |
| Enrichment / identity | **Splink** (MIT) + **nomenklatura** (MIT) for canonical person resolution | De-risks the "duplicate sync → zero dupes" Phase 3 exit criterion. |

## Study now (de-risk load-bearing v1 decisions)
- **Graphiti** (Apache-2.0) — bi-temporal fact model; closest analog to the Mirror + append-only Timeline. Study before finalizing `relationships`/`timeline_entries`.
- **microsoft/agent-governance-toolkit** (MIT) — closest analog to the *whole* pipeline (intercept→policy→fail-closed→Merkle audit). **Run its 157 conformance tests as a free harness** before locking Phase-1 governance.
- **OTel GenAI semantic conventions** (Apache-2.0) — read before fixing `decision_traces` JSONB keys (portability to Langfuse/MLflow).
- **Agno permission-scope schema** — before designing the `agents` table.
- **OPA+OPAL vs Cedar** — decide the policy plane early; retrofitting a policy language is costly.
- **Splink + nomenklatura** — canonical dedup pipeline.
- **Hatchet Postgres schema** — confirm RLS compatibility before adopting as the Ritual engine.
- **arcade-mcp** — authorized-tool-calling (keep OAuth tokens out of the LLM context) for Phase-3 integration security.

## Study later
Apache AGE · Temporal (event-sourced replay) · OpenFGA / SpiceDB (Zanzibar ReBAC for Community-scoped policy) · pgvectorscale (>1M vectors) · ParadeDB pg_search (AGPL — wrap) · immudb Merkle hash-chaining (BSL — pattern only) · MemOS / agent-memory tiers · Cognee ECL · Mastra / Kestra ritual schemas · Leantime goal model · tessera transparency log (cryptographic non-repudiation for LP clients).

## Build, don't buy (the moat — no OSS substitutes)
1. The **Universal Action Pipeline** (one governed `execute()` path).
2. The **Variance Adjuster** closed loop (vetoes → `policy_params`, never code).
3. The **two-plane graph identity** model + `relationships` as a first-class derived-signal entity.
4. The **canonical vs per-user relationship tier** split + memory-privacy granularity.
5. The **append-only Ledger + decision_traces** on Bridge's own Postgres.
6. **`capability_scope` enforcement** in the thin runtime (AI sees filtered context).
7. The **Signal contract** (non-null `recommended_action`; no dead-ends).
8. The **projection/security boundary** (Digital Card reads a sanitized snapshot).
9. The **vocabulary/domain model** itself (the anti-CRM firewall).

## License watch-outs (do NOT embed in the SaaS)
- **AGPL:** Plane, Leantime, ToolJet, **ParadeDB pg_search**, Lantern → reference-only, or wrap unmodified behind an internal API.
- **SSPL:** Inngest server (its SDKs are Apache — SDKs only).
- **BUSL:** immudb, Budibase Pro → take the *pattern*, not the binary.
- **fair-code:** n8n (Sustainable Use License) → study-only, never embed/fork.
- **GPL:** OpenProject, Budibase core → schema study only.
- **EPL-2.0:** Huly → usable with care (verify with counsel).
- **Proprietary:** tldraw SDK 4.0 (~$6k/yr for any Orbit canvas) · Ditto.
- **Data licenses:** OpenSanctions *data* is CC BY-NC (code MIT); anthropic skills docs are source-available — write Bridge's own.

## Zero-knowledge tier building blocks (Phase 6 — study-later)
Encryption is deferred; this is reference. No turnkey "zero-knowledge + team-shared + AI-readable-via-scoped-release" exists — **Bridge buys primitives, builds the key layer itself, and budgets a crypto audit.** At **<100 relationship rows**, this is tractable.
- **Crypto primitives:** OpenMLS (MIT, RFC 9420 group keys) · libsodium (ISC) · Google Tink (Apache, envelope KEK/DEK + BYOK) · age/rage (encrypt-to-recipients) · vsss-rs Shamir (Apache, key recovery).
- **Closest turnkey model:** **Jazz** (MIT) — E2EE + team Groups + key rotation on member removal — *but not Postgres-backed*.
- **Postgres-friendly ciphertext transport:** ElectricSQL (Apache, "syncs ciphertext as well as plaintext", BYO keys) · PowerSync (service FSL, SDK Apache) — both leave key management to you.
- **Client-side encrypted search (the <100-row win):** transformers.js (Apache) embeddings + **PGlite + pgvector in-browser** (Apache/PG Lic) — real pgvector on decrypted data, client-side.
- **Honest gap:** team key rotation/revocation + "scoped decryption to AI" (treat the AI as an ephemeral group member receiving a single note's DEK) is bespoke, security-sensitive code → external audit before GA.
