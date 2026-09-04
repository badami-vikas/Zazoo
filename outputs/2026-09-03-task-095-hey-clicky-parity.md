# TASK-095 — The Avatar has hands: Hey Clicky parity — 2026-09-03

User directive (verbatim): *"I want avatar to be fully functional and be able to do every task hey
clicky does. Refer opensource hey clicky alternatives and similar clone repos. I hope implementations
of mouse pointer from clicky avatar can be ported. I dont need circular pointers but proper mouse
pointer"*

## Reuse intake

Sources studied (public READMEs, changelogs, and source layout only; behaviors re-derived, no code
copied — Bridge's shell is Rust/Tauri, the family is Swift/Python/TS):

```yaml
hey_clicky: { url: https://www.heyclicky.com/changelog, version: 1.0.48, license: closed since 2026-04 }
farzaa/clicky: { stars: 7449, license: MIT, cursor: overlay triangle, flight: quadratic bezier + smoothstep, real_input: none }
jasonkneen/openclicky: { stars: 504, license: MIT, cursor: overlay, real_input: CGEvent mouseMoved→down→35ms→up (native mode) }
unn-Known1/clickyX: { stars: 17, stack: Rust+Tauri, cursor: overlay bezier 300ms, real_input: enigo warp+click, no interpolation }
trycua/cua-driver: { stars: 22149, real_input: per-PID SkyLight private API, never moves the real cursor }
bytedance/UI-TARS-desktop: { stars: 38832, real_input: nut.js linear straightTo }
OthersideAI/self-operating-computer: { stars: 10292, real_input: pyautogui moveTo(duration) linear }
arrow_geometry: { ful1e5/apple_cursor: GPL-3 (reference only), daviddarnes/mac-cursors: Apple SLA (not shipped) — polygon authored in-repo }
```

Key finding: Hey Clicky's visible cursor is a drawn overlay flying a smoothstep Bézier; its real input
is a hidden per-window driver that never moves the real pointer. No open-source project with a visible
companion cursor moves the real pointer smoothly. Bridge moves the real one deliberately (ADR-277).

## Capability mapping

| Hey Clicky capability | Bridge before | Bridge now (this task) |
|---|---|---|
| Summon (hold combo / push-to-talk) | ⌘⇧Space PTT, hover ✨ | unchanged |
| Screen understanding (screenshot → model) | consented capture → Groq vision | unchanged; reused per step |
| Voice in / out | Groq Whisper / local `say` | unchanged; Do-mode `say` lines spoken |
| Animated companion cursor flies to `[POINT]` targets | ring glyph, teleports | **arrow pointer** (`AgentPointer.tsx`), flies a bowed smoothstep Bézier, leans + puffs mid-flight, click ring; reduced-motion snaps |
| Draw on screen (highlights, arrows) | typed spotlight/callout/arrow marks | unchanged |
| Computer use: click / type / scroll / open apps | none (visual pointer only) | **`actuator.rs`**: real CGEvent pointer glide, click/double/right, Unicode typing, allowlisted keys, scroll, `open -a` |
| Task loop (look → act → look) | none | **`act.rs`**: bounded (15 steps / 150 s) JSON-action loop, two-stage locator refine, per-step narration (`bridge:act-step`), Stop |
| Safety: never in password fields | Privacy Guard at capture egress | Privacy Guard before EVERY step's capture; model cannot express delete/pay/quit; ⌘Q/⌘W refused |
| User takeover | n/a | real cursor >28 px off the glide path halts the run |
| Memory (PROFILE/VOLATILE) | bounded ask history | unchanged |
| Walkthroughs that detect your click and advance | none | **"Show me how"**: guide mode points + narrates each step and waits for YOUR click near the target (permission-free button-state poll) |
| User scribble-on-screen context | none | **"Circle an area"**: one-drag interactive overlay; rectangle painted red into the consented screenshot + named in the prompt |
| Dictation typed into the focused app | none | **"Dictate into my app"**: Fn-held speech → Whisper → typed via `act_type_text` (same gates; not streaming) |
| Skills library / integrations from the panel | Chat panel inside the overlay | unchanged — the overlay's Chat panel already reaches governed Skills; no duplicate surface |
| Per-app allowlist | none | **"Only act in these apps"** (substring, empty = any), checked every step |
| Background per-window driver (acts without your cursor) | none | NOT LANDED by design — invisible actuation is refused |
| Always-on wake word | refused | refused (no silent sensing) |

## How to run the prototype test

```bash
cd platform/apps/desktop
GROQ_API_KEY=... pnpm tauri dev
```

1. Grant Screen Recording and Accessibility (the Do panel offers "Grant / re-check").
2. Companion panel → **Do** (or type "open Notes and write hello" in Ask; "do/click/type/open…"
   asks route to Do). Turn on "Let Zazoo use my mouse and keyboard". Press **Do it**.
3. Expect: a yellow arrow and the real cursor glide to each target, a ring flashes on click, the
   step list fills with ✓, the run ends "Done". Move the mouse mid-glide → "You moved the mouse, so I
   stopped." Switch off → `ACT_CONTROL_NOT_ALLOWED`. Revoke Accessibility → `ACT_NO_ACCESSIBILITY`.

## Verification (this session, no live desktop run — the at-keyboard walk is the user's)

```yaml
rust: { cargo_test: "195 passed, 1 ignored (+11 new: actuator 5, act 6)", clippy_new_files: clean }
mutation_checks:
  - remove_cmd_q_refusal: key_allowlist_refuses_dangerous_chords FAILED   # then restored
  - click_without_cell_becomes_click: click_without_a_valid_cell_is_refused FAILED   # then restored
web: { typecheck: "0 errors (after workspace packages built)", tests: "117/117", build: pass, ui_rules: OK, vocabulary: OK }
browser_lab: annotate.html?lab=1 (new stub hook) — arrow path renders, click ring centred on the tip
  (DOM rects equal), throttled timers still land the glyph exactly on target
environment_boundaries:
  fresh_worktree: needed generated/native/bridge-sqlite3.dylib copied from a sibling worktree, and
    `pnpm --filter @bridge/*` builds before web typecheck/tests were meaningful
  groq_key_and_accessibility: not exercised — no cloud call and no real input event was posted
```

## Files

- `platform/apps/desktop/src-tauri/src/actuator.rs` — NEW: hands (CGEvent FFI, flight math, takeover)
- `platform/apps/desktop/src-tauri/src/act.rs` — NEW: the Do loop + commands
- `platform/apps/desktop/src-tauri/src/companion.rs` — `monitor_logical_rect`, `accessibility` capability, `speak` shared
- `platform/apps/desktop/src-tauri/src/lib.rs` — modules, state, commands
- `platform/apps/web/src/app/avatar/AgentPointer.tsx` — NEW: arrow glyph + flight
- `platform/apps/web/src/app/avatar/AnnotateApp.tsx` — ring → arrow; `stream`/`pressed` payload
- `platform/apps/web/src/app/avatar/DoRun.tsx` — NEW: Do panel
- `platform/apps/web/src/app/avatar/CompanionAsk.tsx` — Do mode + routing
- `platform/apps/web/src/annotate-main.tsx` — lab stub hook for browser verification
