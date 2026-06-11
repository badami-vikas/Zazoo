# Entity Disambiguation

## Problem
OSINT sources use name-only matching. Same name → multiple real people.
e.g. "Brian Armstrong" = Coinbase CEO + Wells Fargo broker + UCLA medical researcher.

## Entity IDs
Every staged row carries an `eid` field.

| Pattern | Meaning |
|---|---|
| `{subject-slug}-1` | Confirmed target person |
| `{subject-slug}-2`, `-3`, `-4` | Different real person, same name |
| `{subject-slug}-co` | Associated firm / company entity |
| `?` | Unverified — source is name-collision-prone |

## Auto-assignment rules (heuristics)
Sources that auto-assign `-1` (target):
Wikipedia · Wikidata · LinkedIn · Google News · GitHub · WhatsMyName · Email inference · Web footprint · HN

Sources that auto-assign `?` (unverified):
ORCID · OpenAlex · Semantic Scholar · FINRA (individual) · Google Patents · Google Scholar · OpenCorporates

Company scope → always `-co`.

Signals scope → `-1` by default (about the queried subject).

## Analyst override
Staging viewer → check ≥ 2 rows → "Tag as same entity" → assign entity ID + label.
Stored in `data/entity-links.jsonl`. Last vote per row wins in single-analyst mode.

## Crowd-sourced merge threshold (post-alpha)
See constants in `lib/store.ts`:

```
MERGE_THRESHOLD_FLOOR = 5   (minimum votes)
MERGE_THRESHOLD_RATE  = 0.001  (0.1% of platform users)
getMergeThreshold(n) = max(5, floor(n * 0.001))
```

| Platform users | Merge threshold |
|---|---|
| < 5,000 | 5 votes |
| 10,000 | 10 votes |
| 50,000 | 50 votes |
| 100,000 | 100 votes |

**Post-alpha requirement**: entity merges need `getMergeThreshold(platformUsers)` independent analyst votes before being promoted to confirmed.
Entity links in `entity-links.jsonl` accumulate votes across all analysts — count them per `entityId` + `rowIds` pair.

## Dedup key unchanged
`${subjectKey}|${scope}|${label}|${value}|${source}` — rows from the same source run are still deduped on promote. Entity ID does not affect dedup.
