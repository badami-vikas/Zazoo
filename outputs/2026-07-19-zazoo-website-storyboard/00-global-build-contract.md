# Global build contract

This file governs every section. A section file may add detail but may not contradict this contract.

## Content separation

- **Copy** means visible text rendered in accessible HTML. Only text listed under **Copy (only text to display)** may appear.
- **Visual** means scenery, characters, props, lighting, and composition. Visual directions are never displayed as prose.
- **Animation** means timed motion. Every animation labeled mandatory must ship; a static illustration is not an acceptable substitute except for `prefers-reduced-motion`.
- **Interaction** means a user-triggered state change. Ambient animation is not interaction.
- **Emotion** is a creative acceptance criterion, not on-screen copy.
- **Transition** defines how one scene becomes the next. No hard white gaps or unrelated cards may separate scenes.

## Narrative and page behavior

- The page is a continuous dawn-to-night-to-morning story.
- Use full-viewport or near-full-viewport cinematic scenes connected by shared props, lighting, and character movement.
- Aeva physically travels between scenes. Do not make her disappear at one section boundary and reappear without a motivated transition.
- Scroll controls time and camera movement. It must not merely reveal stacked blocks.
- Keep the primary narrative understandable without hovering, clicking, or reading long paragraphs.
- No carousel autoplay controls, decorative dashboards, floating feature pills, generic SaaS cards, comparison tables, icon grids, or emoji artwork.

## Character canon for this website

Use the cast stated in the supplied website brief:

- Aeva: young plush owl; Chief of Staff; lead character.
- Lina: young plush fox; Research Companion.
- Nori: young plush elephant; Operations.
- Bomi: young plush beaver; Builder.
- Jia: young plush swan; Relationships.
- Neva: young plush dolphin; Creativity.

This website brief explicitly makes Aeva an owl. Do not substitute the separate desktop-companion cat design in this public-site storyboard.

All Zazoos share one visual family:

- handcrafted felt or soft watercolor-felt hybrid;
- young, rounded proportions;
- large glossy expressive eyes;
- tiny nose and thread-line mouth;
- rounded nub hands;
- navy clothing with a white collar and one role-specific accessory;
- no visible legs while stationary; short legs appear only during locomotion;
- subtle breathing, blinking, gaze shifts, cheek response, ear or equivalent-species response, and secondary motion;
- competent movement: quick and purposeful, never frantic or slapstick.

Do not use emoji, clip art, flat geometric mascots, stock 3D characters, photoreal animals, or character designs copied from a film studio.

## Art direction

- Overall style: premium illustrated storybook brought to life; warm, tactile, calm, intelligent.
- Background: warm paper `#FAF9F5`.
- Surface: parchment `#F0EEE8`.
- Primary ink: deep navy `#1A2B3C`.
- Body ink: `#2E4057`.
- Working/action accent: steel blue `#4D7EA8`.
- Soft action highlight: `#7FA5C5`.
- Trust/safety accent: sage `#6B7C65`.
- Warm evening accent: amber `#C4955A`.
- Borders, when unavoidable: `#E2DED5`.
- Do not use gradients that look like generic AI branding, neon glows, cyber grids, glassmorphism, or security-red as a dominant color.
- Day scenes use warm indirect daylight. Governance uses calm filtered light. Night uses deep blue with amber pools. The final morning returns to warm daylight.

## Typography

- Display and narrative headings: Source Serif 4, 400-600.
- Body, labels, and buttons: Geist, 400-600.
- Sentence case only.
- Minimum text size: 16 px desktop and mobile; legal text, if later approved, may use 14 px.
- Maximum readable line length: 62 characters for narrative copy.
- Do not imitate Oxford's logo, masthead, proprietary typography, or page chrome. The dictionary scene should use familiar lexicographic hierarchy, not copied trade dress.

## Motion rules

- Character acting uses anticipation, follow-through, ease-in/ease-out, weight, secondary motion, and natural asymmetry.
- Ambient cycles must not synchronize mechanically. Offset blinks, breathing, paper movement, and prop motion.
- Default transition duration: 800-1,400 ms.
- Micro-action duration: 300-1,200 ms.
- Gaze-to-user moments: no more than once every 12 seconds outside a hover interaction.
- No object may move without a story purpose.
- No sound or voice plays automatically. The v1 website is silent.
- Do not use animation to create fake product activity, fake customer data, or fake live system status.

## Scroll and interaction rules

- Desktop: use a camera-like scroll progression with pinned scenes where specified.
- Mobile: preserve the same narrative order using full-width compositions and shorter camera travel; do not shrink a desktop tableau until it is unreadable.
- Hover interactions must also work with keyboard focus and tap.
- Clicking a chapter book changes the active chapter without navigating away or reloading.
- Escape closes any expanded character introduction or chapter detail.
- Focus states must be visible and consistent with the steel-blue action color.

## Reduced motion and accessibility

- Honor `prefers-reduced-motion`.
- Reduced-motion mode uses 3-5 keyframes per scene with 300 ms crossfades; no parallax, orbiting, rapid path motion, or infinite character locomotion.
- Preserve all meaning in accessible names and concise scene descriptions, but do not expose art-direction prose visually.
- Decorative particles and props are hidden from assistive technology.
- Interactive Zazoos, books, and controls use real buttons.
- Maintain WCAG 2.2 AA contrast.
- Never communicate permission, denial, or status through color alone.

## Performance and asset delivery

- Load the hero's first visible frame immediately.
- Defer chapter and night assets until the preceding scene approaches the viewport.
- Target under 2.5 MB for first-load visual assets and under 8 MB for the full homepage after lazy loading.
- Prefer vector rigs, sprite atlases, or optimized canvas sequences. Do not ship a full-screen autoplay video file when equivalent animation can remain sharp and responsive at lower weight.
- If a rendered video is unavoidable, provide WebM and MP4, poster frame, captions only when speech exists, and reduced-motion stills.
- Maintain 60 fps on modern desktop and a stable 30 fps minimum on mid-range mobile.

## Copy governance

- No unapproved claims, customer counts, productivity percentages, pricing, or service categories.
- The supplied numeric Lina introduction and impact statements are storyboard copy, not evidence. They may ship only after the owner approves the figures as truthful. Until then, use the nonnumeric fallback specified in Section 02 and omit unverified quantities in Section 08.
- Do not display internal labels such as Goal, Layout, Animation, Interaction, Emotion, or Transition.
- Do not add `Consulting`, `Training`, `Start free`, `Tomorrow morning, yours could already be working`, email capture, or any footer link from the rejected PDF.

## Global acceptance test

A reviewer watching a screen recording with all text blurred must still understand that Aeva works continuously, coordinates a crew, respects permission boundaries, pauses for human judgment, protects attention, supports the owner's progress, rests privately, and returns the next morning.
