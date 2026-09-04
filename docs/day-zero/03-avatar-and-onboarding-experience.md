# Avatar and onboarding experience

## Experience goal

The Avatar should make Bridge feel present, understandable, and safe. It is the visible companion to the system’s work, not a magical character with hidden powers. A good experience makes four facts obvious:

- what Bridge is doing;
- why it is doing it;
- what information it is using;
- whether the user must decide anything.

The useful lesson from HeyClicky-like companions is immediacy: a lightweight presence that can be summoned, moved, and understood at a glance. Bridge must achieve that outcome with independently created assets, interaction patterns, and code.

## Avatar contract

The Avatar is:

- a companion and status surface;
- an entry point to chat, current work, approvals, and explanations;
- a visible capture indicator;
- a persistent but user-controlled desktop presence;
- accessible and consistent across supported clients.

The Avatar is not:

- an Agent category;
- a data-residency boundary;
- a source of authority;
- a hidden surveillance service;
- a personality that silently changes governance;
- a lifecycle of egg, creature, or maturity states.

## Operational states

| State | Meaning | Required user affordance |
|---|---|---|
| Idle | Available; no active work | Open chat or current Module |
| Working | A named Run is active | Inspect Run, source, progress, and stop rules |
| Awaiting approval | Work cannot continue without a Decision | Open approval with plain-language impact |
| Blocked | Missing permission, information, connection, or policy | See cause and safe next action |
| Error | Work failed | See retained state, retry policy, and support path |
| Capture tell | A brief blink indicating capture occurred | Open resulting inspectable Memory entry |

## Desktop behavior

- Movable without fighting normal window focus.
- Position persists and safely reconciles when displays are added or removed.
- Remains reachable across supported Spaces and fullscreen behavior.
- Close, minimize, and expansion controls are keyboard and screen-reader accessible.
- Does not cover consequential controls without a fast dismiss or move path.
- Provides an unmistakable stop/pause route for active sensing.

Web and mobile show an in-product companion rather than pretending to be a native overlay.

## Onboarding design

Onboarding is a trust ceremony and first-value path, not a configuration questionnaire.

### Stage 1: promise and boundaries

Explain:

- Bridge adapts Modules around work;
- private capture remains Local by default;
- Commons never receives personal data;
- Agents propose and act only within granted authority;
- the user may skip, pause, correct, export, and delete where applicable.

### Stage 2: immediate needs

Ask only what materially changes the first experience:

- role and current priority;
- solo or team context;
- one repeated friction;
- preferred tools or sources;
- communication preference;
- one admired public example, only if relevant to a cited recommendation.

Every question must state why it matters, what changes based on the answer, and whether the answer is retained.

### Stage 3: permissions

Request permissions at the moment of value, not in a wall of consent:

- Accessibility for explicit foreground-app context;
- screen recording only for declared capture features;
- microphone only when voice is enabled;
- integration scopes only for a chosen source;
- cloud inference or egress only when the requested outcome needs it.

Show current operating-system permission truth. Never display a success state based only on a button click.

### Stage 4: governed demonstration

Use one real, bounded action:

1. observe or import a permitted source;
2. visibly record capture;
3. create an inspectable Memory entry;
4. produce a cited recommendation;
5. ask for a clear Decision;
6. apply or reject the proposal;
7. show the resulting Event and what, if anything, was learned.

### Stage 5: progressive learning

Later questions must be respectful:

- state the reason and benefit;
- allow skip, snooze, pause, inspect, correct, and delete;
- avoid repeated questions already answerable from permitted evidence;
- do not turn inactivity into pressure.

## Trust copy standard

Every consequential message should answer:

- What will happen?
- Which data will be used?
- Where will it run?
- Who requested it?
- What could leave the device?
- Can it be undone?
- What will be remembered?

Avoid “AI magic,” “always watching,” “fully autonomous,” and “understands everything.” Product trust should come from accurate explanation and controllability.

## Accessibility requirements

- Full keyboard path and visible focus.
- VoiceOver labels and meaningful control order on macOS.
- Reduced-motion version of every continuous animation.
- No status communicated by color or motion alone.
- Touch targets and no horizontal overflow at 375 CSS pixels.
- Text zoom without clipping critical Decisions.
- Avatar can be minimized without losing access to pending approvals.

## Experience success measures

- Onboarding completion without support intervention.
- Time to first governed value.
- Permission acceptance by permission type, with refusal still leading to value.
- Approval comprehension and edit/veto rates.
- Rate of inspected and corrected learning.
- Capture surprise reports: target zero.
- Avatar dismissal, pause, and re-enable behavior.
- Accessibility task completion.

