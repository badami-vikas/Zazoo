# 2026-07-15 — Zazoo companion avatar: v0 (live) → v0.5 crew redesign + detailed roadmap + rename proposal

## Outcome
- **v0 shipped and live** at `/zazoo.html` (4th Vite entry, platform web app): plush-cat companion + emotional performance engine (11 emotions, spring-blended; `perform({emotion, warmth, confidence, energy, attention, intent, duration})` — the exact agent-plane contract).
- **Decision (ADR-086)**: 2D procedural SVG rig over the spec's Three.js/3D — pushed back with rationale; Director contract keeps 3D swappable later.
- **v0.5 same-session redesign** from user feedback + "Zazoo crew" reference image: young felt-crew look (huge glossy eyes, tiny nose, thread-line mouth, navy suit + white collar, nub hands, no legs, oval tail); emotion-driven cheeks (opacity + puff + color temperature); 3-channel eyebrows (raise/sorrow/furrow); whiskers floating in air; listening ears enlarge (mild Pixar exaggeration); per-emotion breathing frequency + depth; poses — meditating, sneaking, hiding (compresses into dress → miniature grey egg); MacBook-notch home with live peek-on-hover demo; wardrobe (6 cat colors, 5 suit colors, tie/bowtie/scarf/none); purring removed — Zazoo speaks like a Pixar character (voice = Z4); hop rebuilt with anticipation crouch + squash-and-stretch + shadow weight cue.

## Artifacts
- Code: `platform/apps/web/src/app/avatar/zazoo/` (director.ts, ZazooAvatar.tsx, ZazooLab.tsx) + `zazoo.html` + `src/zazoo-main.tsx` + vite entry.
- Requirements (verbatim): `docs/raw/requirement-zazoo-avatar-spec-2026-07-15.md` + `docs/raw/requirement-zazoo-avatar-feedback-2026-07-15.md`.
- Roadmap (rewritten, detailed): `docs/raw/zazoo-companion-avatar-roadmap-2026-07.md` — character bible, Pixar-principles mapping, Z1–Z7 slices with per-slice exit criteria: Z1 notch home + Tauri overlay (rides EG0) · Z2 status/pipeline/capture-blink wiring · Z3 locomotion (legs appear only when moving; find-my-cursor) · Z4 Pixar-style voice + viseme lip-sync (local plane) · Z5 wardrobe persistence · Z6 crew of major animals on one shared skeleton (Commons-packaged) · Z7 long-idle life + personality memory. Perf/a11y budget included.
- Wiki: `docs/wiki/desktop-companion.md` §Zazoo character (+v0.5 subsection).
- Rename Bridge→Zazoo: **AP-022 PROPOSED** (recommendation: character/crew name only; Disney "Zazu" trademark adjacency needs clearance). Awaiting user verdict.

## Verification
- Zazoo files: 0 TS errors (isolated tsc, strict); 0 console errors live.
- Screenshot-verified live: calm/celebrating/sleepy (v0), crew-look calm, meditating (paws together + levitation), hiding (grey mini egg — crossfade ghost bug found and fixed in-session), notch peek-on-hover.
