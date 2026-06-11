# Design audit (wiki)

full: [../raw/DESIGN-AUDIT.md](../raw/DESIGN-AUDIT.md)

Subject: `/Design Bridge AI Interface (Copy)/` = coded React+Vite+Tailwind+shadcn prototype (70 tsx, 12 pages). Stack matches STACK.md.

**Verdict: ~75–80% aligned.** Built early — mirror vibe locked, governance/consent/two-tier not. Fix = additive + vocab scrub, NOT redesign.

**Aligned ✓**: nav (Home/Network/Work/Intelligence/Help/Settings) · Orbit/ring view (~150 ring refs) · action cards (Reconnect/Memory Search/Community Pulse/Career Moves/Open Threads) · vocab (Network/Initiative/Signal/Community/Touchpoint/Memory/warmth/dormant) · stack.

**Misaligned ⚠️**:
1. CRM vocab leak — Lead 21 · Contact 17 · Deal 13 · Pipeline 4. SCRUB (#1 brand rule). Lead→Person, Deal→Initiative, Contact→Person.
2. Workflow 53 + Playbook 27 >> Ritual 13. Bridge ≠ workflow builder. Rename user-facing Workflow→Ritual; Playbook = Ritual template (TBD).
3. Governance near-absent (Review/veto/ledger/policy ~1–2). Add Approvals/Review inbox + Ledger/Decision-Trace view. It's the moat — make it visible.
4. consent=0, canonical=0, visibility=2. Both-party-consent + two-tier visibility (private/team/workspace) MISSING. Highest strategic gap.

**Fix priority**: P1 vocab scrub · P1 governance surface · P1 consent+visibility · P2 Orbit inner-rings/no-naked-scores.

## Fix spec → [../raw/DESIGN-FIX.md](../raw/DESIGN-FIX.md)
Gaps → UI work. Additive, NOT redesign. Grounded in schema v2 tables.
- **F1 vocab scrub** (P1): Lead→Person, Deal→Initiative, Contact(noun)→Person, drop Pipeline; `WorkflowDetail`/`PlaybookDetail` files → `RitualDetail` (template via `is_template`). DON'T blind-sed: "Contact" CTA → "Reach out"; "pipeline" widget = DELETE not rename.
- **F2 Approvals/Review inbox** (P1): top-level + Intelligence widget. pending `ledger`(decision NULL) + diff + why(`decision_traces`) + provenance(on-behalf-of). approve/veto/edit. veto reason → Variance Adjuster.
- **F3 Execution Ledger** (P1): Settings>Governance. `ledger`+`decision_traces`+`delegations`. read-only, append-only, CSV/JSON export (SOC2). delegation lens.
- **F4 Consent+Visibility** (P1, deepest): F4a two-tier Person view (`people_canonical` public read-only vs `people` private warmth/notes, E2EE-bound; overrides shown both); F4b `people.visibility` private/team/workspace (default = `workspace_settings`); F4c both-party-consent intro = `edges`(INTRODUCED) state machine requested→awaiting_both→active|declined. NO silent enrichment/auto-send.
- **F5 Orbit honesty** (P2): inner rings <100, 30k bg searchable, no naked scores.
Roadmap: F1 anytime · F2/F3 = P1 spine · F4a = P3 · F4b = P0/P1 · F4c/F5 = P4 · E2EE lock = P6.

## F2–F5 BUILT (rendered prototype, 2026-05-31, mock-data schema-shaped)
ALL design-fix F0–F5 now DONE. Additive, not redesign. Shell + mirror vibe kept.
- **F2 Approvals** DONE. `/approvals` page + Sidebar nav badge(3) + Intelligence widget. Pending `ledger`(decision NULL): diff(red/green vs prior) · why(`decision_traces`) · provenance(on-behalf-of + delegation) · approve/veto/edit · veto-chip→Variance Adjuster · empty-state. No naked scores.
- **F3 Execution Ledger** DONE. Settings→Governance. Append-only/tamper-evident banner · filter table (actor/decision/resource) · **delegation lens** · **CSV+JSON** · trace drawer (inputs→proposed·diff→reasoning→policy pre/runtime/post→event).
- **F4 Consent+Visibility** DONE (Person view). F4a two-tier: Canonical (source-tagged, read-only, "not yours") vs Private (E2EE-bound, qualitative warmth) + override (both shown). F4b visibility private/team/workspace + workspace-default. F4c intro state machine requested→awaiting_both→active|declined; **active needs 2 approvals** (proven); no silent enrichment/auto-send.
- **F5 Orbit honesty** DONE. Naked warmth `57°` / trust `82%` → qualitative (Hot/Warm/Cooling/Dormant). Footer: <100 inner-ring + ~30k canonical searchable.
- New files: `data/governance.ts` · `pages/ApprovalsPage.tsx` · `components/ExecutionLedger.tsx` · `components/PersonTiers.tsx`.
- Verified rendered: mounts clean · 0 console err · 0 naked °/% · on-brand. **Design-fix backlog now empty.** Next = wire to real backend (post-pilot) + SOC2 helper/extension hardening.
