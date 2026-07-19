# 2026-07-19 — Bear avatar 2.5D action mock (Zazoo crew)

**Ask:** Recreate the plush blue bear reference avatar in 2.5D with mock (non-engine) animations for three actions — taking meeting notes, reviewing documents, searching — under the 12-point collectible style guide the user supplied (one egg volume, body-first proportions, painted-on clothing, centered face, small standardized eyes, minimal expression, muted pastel palette, props ≤ 20% body width, nub limbs, soft felt texture).

**Deliverable:** self-contained HTML/SVG/CSS mock — no engine, no director, no product code.

- File (durable copy): [`outputs/2026-07-19-bear-avatar-25d-mock.html`](2026-07-19-bear-avatar-25d-mock.html)
- Published artifact: https://claude.ai/code/artifact/bc471bb4-8a0c-4dbb-8f95-fdbb0e007dd4

**States:** Idle (mug + steam + breathing + blink) · Taking meeting notes (notepad, gripped pencil scribbling in bursts with listen-up glances) · Reviewing documents (two-paw sheet, line-by-line gaze scan, periodic page flip) · Searching (magnifying-glass sweep with paw riding the handle, "found it" sparkle + bounce). Action chips + auto-cycle; honors `prefers-reduced-motion`; light/dark theme tokens.

**Notes:**
- An earlier in-repo build (new bear rig + `takingNotes`/`reviewing`/`searching` actions in the Zazoo director/lab) was reverted at the user's direction — they wanted a mock, not a functional prototype. Worktree is clean of those edits.
- Rendering gotcha worth keeping: SVG attribute `rotate(a x y)` misbehaves under `transform-box: fill-box` when ancestors carry CSS transforms — use CSS `rotate()` about the element's own fill-box center instead.
- Verified headlessly (playwright-core, channel: chrome) — all four states screenshot-checked, zero page errors.
