# Section 04 - Chapter library

## Goal

Let the visitor choose among Values, Process, Difference, and Impact without turning the experience into tabs or dashboard navigation.

## Layout

- Height: 100 vh on desktop; minimum 100 svh on mobile.
- One warmly lit library table occupies the lower half of the frame.
- Four distinct clothbound books rest on the table in a shallow arc, with readable titles on their covers.
- Aeva stands beside the books and watches the visitor's attention, not the pointer itself.
- Behind the table, four faint illustrated doorways preview the visual world inside each book.
- The current reading order is left to right: Values, Process, Difference, Impact.
- This is the only website section that acts as navigation between chapter scenes.
- Do not place subtitles under the books.

## Animation (mandatory)

Ambient loop: 10 seconds.

- Dust motes drift through one shaft of warm light.
- Book cloth and page edges remain tactile and still; books must not bob like UI cards.
- Aeva straightens one slightly crooked book, checks the next page marker, and looks toward the visitor.
- Every 10 seconds, one closed book gives a nearly imperceptible page-settle motion. Never animate all four at once.

Selection animation: 1.4 seconds.

1. The selected book slides forward 24 px.
2. Aeva places one paw/wing/hand on its cover.
3. The cover opens toward the camera.
4. The page illustration expands into the next full-screen chapter.

Returning to the library reverses the transformation and preserves the last selected book's page marker.

## Interaction

- Each book is a real button with its title as the accessible name.
- Hover/focus lifts the book edge by no more than 6 px and brightens its doorway preview.
- Click/tap opens the selected chapter.
- Keyboard order follows Values, Process, Difference, Impact.
- After completing a chapter, the next book opens automatically only if the visitor continues scrolling. Clicking `Back to the books` returns immediately.
- Direct scrolling through the page uses the default order: Values, Process, Difference, Impact.
- Do not use tabs, card borders, pills, carousel arrows, pagination dots, or selected-state outlines that resemble a SaaS component.

## Copy (only text to display)

`LIBRARY-H1`

> Four chapters of a Zazoo's life.

Book titles:

> Values

> Process

> Difference

> Impact

Chapter return control:

> Back to the books

## Emotion

Invitation and curiosity. Choosing a chapter should feel like opening a treasured story, not changing a setting.

## Transition

Each book opens into its own visual world. In the default scroll path, the Values cover opens into a watercolor corridor outside a meeting room.
