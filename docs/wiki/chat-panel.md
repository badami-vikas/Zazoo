# Chat Panel

full: [../raw/governed-chat-panel-plan-2026-07.md](../raw/governed-chat-panel-plan-2026-07.md)

TASK-026 DONE 2026-07-27. Right Chat Panel = durable Chief of Staff. Same thread in full Page +
desktop Avatar.

**Built:**
- desktop private thread → Local Plane only
- hosted web → public-safe turns only
- no private cross-device/cloud sync
- Qwen3 4B Q4_K_M + managed signed `llama-server`
- Human starts model download; hash/license/provenance checked; 2,497,280,736 bytes pinned
- cloud model = fresh consent for exact public turn; never sticky
- RunContextAssembler = persona + bounded history + authorized surface + accepted Memory +
  relevant installed Agent-owned Skills + governance
- model chooses direct answer / clarify / one typed Skill candidate
- server chooses real Agent/Goal/Task/Skill. Model never grants authority.
- existing pipeline owns Proposal→Decision→Run→Result
- Chat shows same real proposal as Approvals
- durable retry/cancel/archive/delete + restart/crash recovery
- forged proposal, cross-Plane ID, DB mutation, signing, lease, cancellation, polling, draft, schema
  blockers closed
- responsive 375/768/1440; keyboard/focus/Axe clean

**No fake:** model absent → setup state. No eligible Skill → honest answer / Capability Builder
proposal. No generic mutation labeled execution.

**Proof:** real Qwen multi-turn; real Task proposal approved to terminal Run/Result; same thread
panel/Page/Avatar; API + full app restart retained; model crash recovered; hosted private denied.
Rebuilt app deep-signed, Keyring loaded, exact `NATIVE_OK`, abrupt-exit recovery + clean quit passed.
Full tests 40/40 tasks. Rust 59/59. Bundle 8/8. Independent re-review clean.

Windows release + unchanged seven HIGH/one MODERATE dependency advisories stay TASK-018. Paid
Anthropic proof stays TASK-022.
