# Glossary expansion and course correction

Source reviewed: [Bridge Glossary artifact](https://claude.ai/code/artifact/a35a7f24-4116-483e-9450-878957e669fb) — 343 entries across 27 categories.

## Outcome

`docs/glossary.md` now contains 164 durable canonical terms. The source was treated as an input, not authority: stable concepts were retained, duplicates consolidated, implementation-only symbols omitted, and definitions rewritten to AP-020 and the newest Module, Plane, Avatar, Engine, Relation, File, Event, and execution decisions.

## Course corrections applied

- Database/Record/Relation replaces the artifact’s older generic row taxonomy.
- Memory and Knowledge remain distinct durable sources; Context is only their assembled-use umbrella.
- File and Result replace the artifact’s older output overlap.
- Avatar is one companion concept with transient capture blink and operational presence only; lifecycle, animal, ceremony, and personality taxonomies were excluded.
- Engine is runtime machinery. Skill is one bounded callable job. Automation owns a trigger or schedule. Agent is a bounded reasoning actor.
- Only Local Plane and Cloud Plane are Planes. Relationship and Work are Domains; Commons and Bridge Cloud are services.
- Relationship is one Module containing People, Communities, Relations, Interactions, Introductions, Helpdesk, Sources, and Automations.
- Project-like work is a Module-owned Record, not installed functionality or a platform primitive.
- Review Mode is computed and recorded; it is not an independently configured approval ladder.
- Runtime Taint Tracking reflects the RT0–RT4 propagation requirement rather than the artifact’s source/egress-only description.
- Display-only aliases, stale shell names, old code identifiers, exact library versions, raw TypeScript symbols, and speculative Agent archetype names were not admitted to the canonical glossary.

## Added coverage

The glossary now covers platform structure; the Request-to-Result chain; actors, capabilities, and Engines; governance and authority; residency and services; context and sensing; controlled intake and taint; Avatar and standard UI; Commons distribution; Relationship, DealPilot, and JobPilot domain terms; and vocabulary scopes.

## Validation

- 164 canonical entries.
- No matches for the AP-020 deprecated-term denylist.
- Markdown whitespace validation passes.
