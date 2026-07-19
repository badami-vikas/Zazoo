# Zazoo website optimization — 2026-07-18

Shipped the optimized zazoo marketing site to https://github.com/badami-vikas/badami-vikas.github.io (commit 0202c17), live at https://zazoo.me (Pages build green, both URLs 200).

## What shipped
- Static vanilla rebuild of the Zazoo design-system kit (claude.ai/design project a0107da2): no React/Babel CDN, one CSS + one JS file, tokens preserved.
- `index.html` — landing with interactive companion family selector (hover/click), new "Work is reorganizing itself around AI" big-picture section, trust/flow/compare/values.
- `training.html` — current programs (6-month leadership journey as an interactive SVG wheel, 3 workshops) + future programs (AI-native manager intensive, Agent builder studio, Personal AI systems, AI readiness for leaders) with Running now / Coming next filter tabs.
- `consulting.html` — repositioned off Zazoo onto AI readiness, systems building (agents / workflows / skills / hooks / integrations / evals / governance), interactive "what's blocking you" selector, AI-trends section (agentic production adoption, workflow-integration priority, context-as-moat, personal-beats-general). Replaced the "AI chief of staff" belief line the user disagreed with: "The future of AI isn't one assistant for everyone. It's AI that is uniquely yours…"
- `docs/experience-guide.md` — empathy/emotional-continuity implementation guide (tokens, companions, voice, motion rules).
- `docs/website-interactions-task.md` — planned follow-up task: full interactive redesign per reference kit 7fd94b1d + 2.5D unique-animal Zazoos. Background-task chip raised (task_09acc6c8).

## Verification
All three pages exercised in Chrome against a local server: family selector lock/dim, journey wheel select, program tabs filter, blocker chips, zero console errors.

## Follow-up same day: homepage as a day in a Zazoo's life (commit 063997a)
Rebuilt `index.html` around the core principle "follow a Zazoo through its day; every animation answers: what is my Zazoo doing while I'm busy?":
- Hero: living circular workspace orbiting owl-Aeva, task ticker, companionship bubbles, yawn/stretch appeal.
- Dictionary scene: Oxford-style "Zazoo /za·zoo/ noun" entry + the new unique-animal family (🦉 Aeva, 🦊 Lina, 🐘 Nori, 🦫 Bomi, 🦢 Jia, 🐬 Neva). Hover pauses the world; the chosen companion looks at the visitor (cursor eye-tracking) and introduces itself with weekly numbers + its Pixar-appeal quirk.
- Governance castle: guardian Zazoos (Owl Judge, Elephant Security, Dog Gatekeeper, Bear Auditor), looping gentle robot refusal ("Sorry. Not authorized."), mirrored trust statements.
- Four chapter books: Values storybook, Process footprints (pause at Decision, "waits for you"), behavior-based Difference stories (8 "Some AI vs A Zazoo" vignettes + the Mountain signature visual + "companions improve one another" differentiator), Impact.
- Night finale: Privacy Mode, Aeva's cottage, the dream ("She never climbs the mountain. She makes the climb possible.").
- New `assets/menagerie.js` (animal SVG library, eye tracking, quirks; reduced-motion safe). Brand guidelines rewritten in `docs/experience-guide.md`. Verified scene-by-scene in Chrome; live at zazoo.me.
