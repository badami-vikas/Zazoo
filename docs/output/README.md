# Output — non-permanent model outputs

Answers, status checks, gap audits, one-off analysis: anything that answers a question WITHOUT
changing code and WITHOUT adding durable knowledge that belongs in `raw/`+`wiki/`. Session-scoped by
default.

## Filing rule
- File name: `YYYY-MM-DD-short-topic.md`.
- No frontmatter required (these aren't `raw/` docs — they're not meant to be cited by wiki pages).
- If an output turns out to contain genuinely new synthesized knowledge worth keeping, it gets
  PROMOTED to `raw/` + a `wiki/` companion — but only after asking first (per
  [../wiki/index.md](../wiki/index.md) Protocol § Non-permanent outputs). Don't let this folder
  become a junk drawer that quietly becomes load-bearing.
- Nothing in here is a `companions:`/`related_wiki:` target from a raw doc. If something here gets
  cited from a raw doc, that's the signal it should have been promoted instead.

## What does NOT belong here
- Anything that changes code, schema, or config → goes in the actual change + a `docs/log.md` entry.
- Decisions with rationale → `docs/raw/decisions-log.md` (ADR entries).
- New plans → `docs/plan/` (see [../plan/INDEX.md](../plan/INDEX.md)).
