---
title: Zazoo Companion Avatar — Character Bible, Performance Engine, and Roadmap
type: raw
doc_kind: plan
status: proposed
companions: [egg-commons-feature-roadmap-2026-07.md, desktop-companion-agent-roadmap-2026-07.md, requirement-zazoo-avatar-spec-2026-07-15.md, requirement-zazoo-avatar-feedback-2026-07-15.md]
related_wiki: ../wiki/desktop-companion.md
updated: 2026-07-15
tags: [avatar, companion, zazoo, egg, animation, emotion, desktop, pixar, notch, wardrobe, characters]
---

# Zazoo Companion Avatar

The companion avatar (Egg track) has a flagship character: **Zazoo** — a young plush-felt cat with
round spectacles, part of the "Zazoo crew" visual family (user reference image 2026-07-15: felt egg
bodies, huge glossy eyes, tiny noses, thread-line mouths, navy suits with white collars, nub hands,
no legs). Verbatim specs: `requirement-zazoo-avatar-spec-2026-07-15.md` (original) +
`requirement-zazoo-avatar-feedback-2026-07-15.md` (crew-alignment feedback). This doc is the
context-aware adaptation and the build plan.

## 1. Character bible

```yaml
identity:
  name: Zazoo (per-user renameable via avatar-store `avatarName`)
  age_read: young apprentice — big eyes low on the face, small features, rounded everything
  role: Chief of Staff — professional, empathetic, humble, curious, quietly confident
  voice: speaks/giggles like a Pixar character — bright, breathy, small; NEVER purrs (user directive)
  home: the MacBook camera notch — hover it and Zazoo peeks its head out
silhouette_rules:
  - egg body, no legs at rest (legs materialize only in locomotion states)
  - nub hands (mitten ovals), oval plush tail (never a tube)
  - every design element rounded; silhouette alone must read "comfort + trust"
visual_family: # crew style tokens (round-2 corrected)
  eyes: huge glossy near-black discs, two white highlights (4.4px + 1.9px)
  spectacles: an ACCESSORY (add/remove), never anatomy
  nose: micro-dot only — clearly separated from the mouth; nose and mouth must never read as one cluster
  mouth: ONE element — a thread-line curve whose interior opens (lens shape) for speech/joy; two stacked mouth marks are a defect
  brows: fully animated — raise / sorrow / furrow / LENGTH variation; visible contrast weight
  cheeks: soft discs — OPACITY (blush amount), SCALE (puff), and COLOR TEMPERATURE (pale pink→warm coral) all emotion-driven
  hands: tiny jointless mittens resting IN FRONT on the suit (reference image), not at the sides
  dress: tailored suit JACKET read — lapels + white shirt V + accessory (tie/bowtie/scarf/none), wardrobe-customizable
  hide: Zazoo ROLLS forward and wraps itself in its own suit — diegetic compression (rolling reduces size), ending as a tightly-wrapped cloth egg IN THE SUIT'S COLOR; never a plain scale-down
  notch_home: the on-screen rectangular notch (MacBook M2 Air class); Zazoo peeks HEAD-ONLY to the LEFT of the notch on hover
  palette: warm felt neutrals; body + suit colors user-selectable (6 body / 5 suit presets in v0.5)
```

## 2. Pixar meta-analysis → Zazoo design canon

This section is the **standing canon** that shapes every future evolution of Zazoo and the crew —
not a record of what happens to be implemented. Requirement source:
`requirement-zazoo-avatar-feedback2-2026-07-15.md`. Where Pixar's practice and Bridge's brand pull
in different directions, the Bridge adaptation column wins.

### 2.1 Character DESIGN meta-analysis (what makes Pixar characters read instantly)

```yaml
shape_language:
  pixar: circles = safe/friendly (Baymax, EVE's egg), squares = reliable, triangles = dynamic/threat; a character IS its dominant shape
  zazoo_canon: the crew is 100% egg/circle language — comfort + trust at silhouette level; NOTHING angular ever enters a crew character's silhouette (accessories may be angular only when miniature: tie, notebook)
silhouette_first:
  pixar: a character must be identifiable and its pose readable from a solid-black silhouette (the "silhouette test")
  zazoo_canon: every new pose and every new crew species must pass the silhouette test at 64px — the overlay avatar is often < 100px tall; if a pose reads only through interior detail, redesign it
baby_schema_appeal:
  pixar: appeal engineered via infant proportions — oversized eyes set LOW on a large head, tiny nose/mouth cluster, no visible joints (Boo, young Dory)
  zazoo_canon: eyes ≈ 1/3 of face width, set at/below the vertical midline; nose = near-invisible micro-dot; mouth = one thin thread line; hands = jointless mittens; NO legs at rest (jointlessness is the plush read)
facial_hierarchy:
  pixar: information order is eyes → brows → mouth → everything else; eyes carry thought, brows carry attitude, mouth carries energy; features NEVER compete (one dominant channel per beat)
  zazoo_canon: same ordering enforced in the director — each emotion declares its dominant channel (listening=ears, concern=brows, joy=cheeks+mouth); nose is NOT a channel and must never visually merge with the mouth (round-2 defect); mouth is ONE element that opens, never two stacked marks
material_honesty:
  pixar: characters commit to their material — Woody moves like stitched cloth, Buzz like molded plastic; material constrains motion
  zazoo_canon: the crew is FELT — soft gradients, no specular shine except eye highlights + camera-lens glint; motion must feel padded (springy, damped, never snappy-rigid); clothing is part of the body volume, which is WHY hiding = rolling into one's own suit works
economy_of_detail:
  pixar: detail budget spent only where the eye looks (faces), aggressively simplified elsewhere
  zazoo_canon: face gets the polygon/param budget; body/dress = flat felt shapes + at most one seam/fold; if a detail isn't legible at 64px it doesn't exist
costume_as_role:
  pixar: costume states the job before the character speaks (Edna's designer wear, Merida's bow)
  zazoo_canon: business-casual suit + white collar = Chief-of-Staff at a glance; accessories (tie/bowtie/scarf/spectacles) are all REMOVABLE identity dials the user owns; spectacles = "thoughtful advisor" tell, not anatomy
```

### 2.2 ANIMATION meta-analysis (the 12 principles, adapted)

```yaml
squash_and_stretch: {pixar: volume-preserving deformation sells softness, zazoo: body squash on sneak/anticipation + stretch at hop apex; felt = generous squash, restrained stretch}
anticipation: {pixar: every action telegraphed first, zazoo: hop crouches first; peek leads with ear tips; before any locomotion the body coils}
staging: {pixar: one idea per beat, camera/pose serve it, zazoo: one dominant expression channel per emotion; the director may not fire two gestures at once}
straight_ahead_vs_pose: {pixar: keys for acting, simulation for secondary, zazoo: emotions = pose targets (keys); breath/whiskers/blinks = continuous simulation layered under}
follow_through_overlap: {pixar: appendages drag behind and settle after, zazoo: whiskers + spectacles + tail lag primary motion on their own springs; nothing stops all at once}
slow_in_slow_out: {pixar: eases everywhere, zazoo: critically-damped springs on EVERY parameter — linear motion is banned}
arcs: {pixar: natural motion curves, zazoo: gaze leads → head tilts → 2.5D face parallax follows; hop/peek paths are sine arcs}
secondary_action: {pixar: supporting motion that never steals focus, zazoo: cheek color/puff, ear micro-twitch, breath — all sub-threshold amplitudes}
timing: {pixar: timing IS the emotion (same pose, different meaning at different speeds), zazoo: per-emotion breathing FREQUENCY+DEPTH, blink cadence, spring speed scaled by energy axis}
exaggeration: {pixar: push past real toward the idea, kept plausible, zazoo: MILD dial — listening ears enlarge 1.28x, celebration floods cheeks; workspace context caps exaggeration (see 2.4)}
solid_drawing: {pixar: forms keep volume/weight in every pose, zazoo: ground-shadow reacts to airtime; rolls/squashes preserve apparent volume — extrinsic uniform scaling is BANNED as a motion device (round-2 rule: hiding rolls/wraps, never shrinks in place)}
appeal: {pixar: charisma in every frame incl. villains, zazoo: young/round/soft always; even "concerned" must stay adorable — test any new expression at its most extreme frame}
```

### 2.3 ACTING meta-analysis (behavior, the layer above animation)

```yaml
thought_before_action: eyes move FIRST, then head, then body (Pixar's core acting rule) — the director's gaze springs run faster (2.5Hz) than head (1.4Hz) by design; every gesture must be preceded by a visible micro-decision
moving_holds: a "still" character is never frozen — breath, blinks, micro-saccades, weight shifts keep it alive at amplitudes below attention threshold
asymmetry: perfect symmetry reads dead — brows may act independently, ear twitches are single-sided, saccades are random-walked
eyes_are_the_soul: blink rate = cognitive state (fewer when focused, slow when trusting/sleepy, double-blink = hesitation); pupils dilate with interest; eye contact is comfortable, never a stare
laytime: after every performance, return to calm THROUGH a settle, never a cut
```

### 2.4 Bridge/brand adaptation — where we deliberately diverge from Pixar

```yaml
ambient_not_theatrical: film characters fight for attention; Zazoo shares a workspace — motion budget is capped (idle amplitudes sub-threshold, big performances only on real events), attention theft is a bug
restraint_dial: exaggeration scales with context — workspace beats cap at "mild", celebration/onboarding may go "medium"; never cartoon-manic (professional trust brand)
trust_first: the capture-blink tell is sacred honesty (avatar blink = the tell, capture contract); no performance may mask or fake operational state; hiding is a USER affordance, never something Zazoo does to conceal activity
calm_authority: Chief-of-Staff persona = quiet confidence — default posture upright-soft, no fidgeting under pressure; "unsure" performs thoughtful consideration, not anxiety (original spec)
crew_system_over_star: Pixar builds one hero; Bridge builds a FAMILY on one skeleton — every design rule above must hold for any species overlay (owl/elephant/beaver/...), which forces the rules to live in the shared rig + director, not in per-character art
```

### 2.5 Standing do-nots
- No uncanny realism, no photoreal fur/materials — felt forever.
- No two stacked mouth marks; nose and mouth never merge (round-2 defect class).
- No extrinsic scale-down as a motion shortcut — compression must be diegetic (roll, tuck, wrap).
- No constant motion; no sound without user-initiated or governed cause.
- No angular silhouette elements on crew bodies.

## 3. Shipped

```yaml
v0_2026-07-15: first rig + director + lab (see log)
v0.5_2026-07-15: # crew-alignment redesign, same session
  look: young crew-style rig — glossy eyes, tiny nose, thread mouth, suit+collar+accessory, nub hands, oval tail, no legs
  cheeks: emotion-driven opacity + puff + color temperature
  brows: raise / sorrow (inner-up) / furrow (inner-down) — three independent channels
  whiskers: airborne sway (dual-sine + breath), droop channel
  ears: enlarge on listening (1.28, mild exaggeration), twitch, perk/droop
  breathing: per-emotion frequency + depth (user requirement)
  poses: meditating (paws together, closed eyes, levitation bob, 0.07Hz breath) · sneaking (squash, furrowed brows, darting saccades, creep bob) · hiding (compresses into dress → miniature grey oval egg remains)
  notch: peek demo — menubar + camera notch mock; pointer near notch → head springs out (0.9s overshoot bezier), retreats on leave
  petting: giggle wiggle + open-mouth smile + flooded cheeks (purring REMOVED — Zazoo speaks)
  wardrobe: cat color (6) + suit color (5) + accessory (tie/bowtie/scarf/none) live in lab
  gestures: hop rebuilt with anticipation crouch + air stretch + shadow reaction
  verified: live at /zazoo.html — meditate/hide/peek screenshot-verified; hide ghost fixed (opacity clamp); 0 TS errors, 0 console errors
```

## 4. Roadmap — slices with exit criteria

### Z1 — Notch home + desktop overlay (rides EG0 COMPANION-MOBILITY; next session)
- Tauri: companion window docked at the physical notch position (`NSScreen.safeAreaInsets` on
  macOS; fallback = top-center of the active display for non-notch machines/Windows).
- Global hover detection (Rust side, throttled cursor poll) → peek performance; click →
  full-body drop-down to desktop; drag away = spec's dragging behavior (compress, surprised eyes,
  smooth recovery on release).
- Peek is a *performance*, not a transition: anticipation (ear tips first), overshoot settle,
  curious gaze at the cursor.
- Hide pose = the overlay's "get out of my way" affordance: double-click or `hide` command →
  grey mini egg parks at the notch edge; click revives.
- Reduced-motion: springs settle instantly, oscillators off. rAF pauses when window hidden.
- **Exit criteria**: peek-on-hover on a real notch MacBook + non-notch external display; drag
  matrix (Spaces, fullscreen apps, display attach/detach) passes; idle CPU < 1% hidden, < 3% visible.

### Z2 — Status, pipeline, and capture wiring
- Operational status → emotion map: idle→calm · listening→listening (ears enlarge) ·
  reading_context→curious · drafting→thinking · awaiting_approval→unsure ·
  blocked_by_policy→concerned · error→concerned(+furrow).
- `sensor.capture` → deliberate capture-blink tell (distinct double-blink + spectacle glint),
  clickable → inspectable Memory entry (capture contract).
- Pipeline beats: task completed→celebrating(duration 3.5) · milestone→proud · morning
  brief→listening · long-focus nudge→comforting · evening wrap→sleepy.
- **Exit criteria**: every status/pipeline event visibly performed within 300ms; capture blink
  distinguishable from ambient blink in a blind A/B check; all beats auto-return to calm.

### Z3 — Locomotion (legs appear only when moving)
- Walk/run cycle: stubby legs extend from under the suit only in locomotion states; egg body
  bobs with weight; ears + whiskers lag (follow-through).
- "Find my cursor": look around → spot → run to cursor → point proudly → settle (spec beat).
- Sneak becomes a *moving* state: tiptoe creep across the screen edge.
- **Exit criteria**: rest↔walk transitions show legs growing/retracting smoothly (no pop);
  cursor-find lands within 24px of the pointer; sneak locomotion keeps the squash posture.

### Z4 — Voice: speaks like a Pixar character
- Local-plane TTS behind `ModelProvider`/voice seam (capture/sensor plane = local models default);
  a bright, small, breathy character voice (pitch-shifted + formant-tuned preset, not a stock
  assistant voice). No purring anywhere.
- Viseme-driven `mouthOpen` sync; brows + head bob follow prosody (speech IS a performance input).
- Pet response upgrades from silent giggle to voiced giggle.
- **Exit criteria**: audible speech lip-synced within 80ms skew; voice output never leaves the
  local plane; mute + reduced-motion respected.

### Z5 — Wardrobe & identity persistence
- Dress-up + cat color + accessory persisted per user in `avatar-store` (localStorage → kernel
  prefs when schema v2 lands); rename retained (`avatarName`).
- Outfit slots: suit / accessory / headwear (beanie, party hat for celebrations); seasonal packs
  later via Commons.
- **Exit criteria**: appearance survives restart + follows the user across web/desktop surfaces;
  changing outfits is itself performed (Zazoo looks down at the new tie, approves).

### Z6 — The Zazoo crew: additional major-animal avatars
- Shared skeleton: ONE director + ONE egg-body rig; species = feature overlay (ears/tail/beak/
  trunk/fins) + palette + accessory defaults — exactly how the reference image reads as one family.
- Wave 1 (major animals, aligned with the existing 14 spirit-animal roster): owl · elephant ·
  beaver · wolf · horse · whale/dolphin · bear · fox · panda · turtle.
- EggHatcher onboarding: egg hatches → chosen crew member emerges (Zazoo the cat = default).
- Each character ships as a Commons capability package (CM-track supply-chain rules apply).
- **Exit criteria**: 3+ species live with zero director changes; hatch→character flow replaces
  the static spirit-animal picker; a new species is addable in < 1 day of work.

### Z7 — Long-idle life + personality memory
- Idle scheduler: meditation (shipped as pose) · reading (tiny notebook, page turns) · tea break ·
  cat stretch + yawn · nap (curled, tail wrapped, ear twitches).
- Personality memory: previous emotional context gently biases the next performance (Mem0-backed,
  local plane); remembers achievements to celebrate anniversaries of.
- **Exit criteria**: after N min idle Zazoo drifts through activities (never loops one); emotional
  carry-over observable (a rough morning → softer afternoon presence).

## 5. Performance & accessibility budget
```yaml
idle_cpu: "<1% hidden, <3% visible (rAF paused when occluded)"
bundle: rig+director stay dependency-free (no three.js, no lottie)
reduced_motion: prefers-reduced-motion → instant settles, no oscillators, no hop
a11y: role=img + aria-label; every state change also exposed as text status for screen readers
```

## 6. Naming note
"Zazoo" = the character (and crew brand). Platform rename Bridge→Zazoo remains a separate canon
decision — AP-022 in `docs/APPROVALS.md` (session recommendation: character-name only; trademark
adjacency to Disney's "Zazu" needs clearance before any platform-level use).
