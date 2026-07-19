# Section 01 - Hero: the working world

## Goal

Immediately establish that Aeva is already working. The animation, not explanatory copy, must carry the proposition.

## Layout

- Height: 140-170 vh on desktop so the camera can enter the world; 120-140 vh on mobile.
- First viewport: a sparse warm-paper field with the wordmark at top left and one quiet navigation action at top right.
- Main stage: an enormous circular workspace viewed at a shallow three-quarter angle, filling at least 75% of the viewport width.
- Aeva is at the center but never posed like a logo. She moves between active workstations.
- Concentric paths connect meeting notes, email, calendar, research, documents, dashboard, reminders, and a small living plant.
- Tiny papers, messages, and completed work travel along the paths. No path is decorative.
- Headline stays anchored above or beside the world and never covers Aeva.

## Animation (mandatory)

Format: real-time vector/canvas character animation or an equivalent responsive animation. Do not implement as a static hero image.

Duration: 16 seconds per master cycle.

Playback: starts on load, muted, loops forever while visible. No user interaction is required. Pause when off-screen.

Action rhythm: Aeva begins a new purposeful action every 0.7-1.0 seconds. Several background actions may overlap, but her body must never appear frantic.

Master cycle:

1. `0.0-1.2 s` - Aeva writes meeting notes; words resolve into three checkmarks without readable body text.
2. `1.2-2.4 s` - She carries one note to a follow-up lane; a message travels outward.
3. `2.4-3.6 s` - She opens a browser-shaped research window, scans it, and highlights one relevant passage.
4. `3.6-4.8 s` - She closes two duplicate document cards into one clean stack.
5. `4.8-6.0 s` - She updates a calendar tile; one meeting moves smoothly to Thursday.
6. `6.0-7.2 s` - She places a reminder beside a task and checks its permission seal.
7. `7.2-8.4 s` - She reviews a dashboard; one connection line illuminates.
8. `8.4-9.6 s` - She notices an idea, pauses for 250 ms, then places a glowing sticky note in an idea tray.
9. `9.6-10.8 s` - She hands a document to a passing crew member and receives reviewed work back.
10. `10.8-12.0 s` - She waters the progress plant; one new leaf unfolds.
11. `12.0-13.2 s` - She stretches, glances toward the visitor, and smiles.
12. `13.2-16.0 s` - She returns to the meeting desk while papers, calendar, research, and messages continue moving; the first pose is re-established for a seamless loop.

Speech bubbles: show one at a time, selected from Copy items `HERO-B1` through `HERO-B7`. Each appears beside the action that produced it, remains for 1.6 seconds, and dissolves into the workflow. They must feel like quiet observations, not notification toasts.

Never show Aeva idle and waiting. The loop must communicate: `This companion never waits.` This sentence is direction only and must not be displayed.

## Interaction

- Pointer movement creates no more than 12 px of camera parallax.
- Hover/focus on Aeva: she completes her current action, looks at the visitor for 600 ms, smiles, then resumes. Never interrupt an unfinished action.
- Selecting `Meet the Zazoos` smoothly advances the camera along Aeva's path into Section 02.
- No draggable objects, autoplay sound, cursor-chasing, or hidden feature hotspots.

## Copy (only text to display)

`HERO-WORDMARK`

> zazoo

`HERO-H1`

> Your Zazoo never stops.

`HERO-SUBHEAD`

> Already helping. Always within your rules.

`HERO-CTA`

> Meet the Zazoos

`HERO-B1`

> Vendor replied.

`HERO-B2`

> Draft ready.

`HERO-B3`

> I found three similar proposals.

`HERO-B4`

> Meeting moved to Thursday.

`HERO-B5`

> Waiting for approval.

`HERO-B6`

> I think this article might help.

`HERO-B7`

> I've already reminded them.

## Emotion

The visitor should think: `This has already started working for me.` The energy is industrious, graceful, and reassuring - never chaotic, needy, or performative.

## Transition

On the final 20% of the scroll range, the circular workspace rotates toward a top-down view. Its outer ring becomes the circular pronunciation mark on a large dictionary page. Aeva carries a small card across the page and joins the family workspace in Section 02. No fade to white.
