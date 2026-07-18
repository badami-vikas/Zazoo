# Git contribution and coding-pace comparison

Snapshot: `main` and `origin/main` at `1ce0007e8075` after refreshing `origin`
on 2026-07-18. The worktree was clean.

## Result

Manish has fewer cumulative changed lines than the Vikas-authored or explicitly
Claude-coauthored history, but a higher current churn pace.

| Scope | Contributor credit | Content commits | Merge commits | Added | Deleted | Churn | Unique files |
|---|---|---:|---:|---:|---:|---:|---:|
| All reachable refs | Manish | 65 | 22 | 107,274 | 10,370 | **117,644** | 385 |
| All reachable refs | Vikas-authored | 141 | 55 | 252,190 | 12,432 | **264,622** | 1,062 |
| All reachable refs | Explicit Claude coauthor | 127 | 11 | 240,117 | 10,796 | **250,913** | 1,009 |
| Landed on `main` | Manish | 35 | 15 | 73,699 | 5,285 | **78,984** | 331 |
| Reachable only from non-`main` refs | Manish | 30 | 7 | 33,575 | 5,085 | **38,660** | 131 |

The 38,660 figure is cumulative commit-level churn, not a single 38,660-line
patch waiting to merge. It sums 33,575 additions and 5,085 deletions across 30
non-merge commits reachable from branches that are not ancestors of `main`;
seven additional merge commits carry no line total. These branches overlap and
include paused, superseded, or competing work, so the same underlying lines can
be counted more than once. Each branch needs its own merge-base diff to measure
the unique pending change that could actually land.

Of that churn, 33,548 comes from 26 content commits also reachable from fetched
`origin/*` branches; 5,112 comes from four content commits reachable only from
local refs. The checked-out `main` files do not contain those branch versions,
although all fetched commit objects necessarily exist in the local Git object
store.

Manish's all-ref churn is 44.5% of Vikas-authored churn and 46.9% of explicit
Claude-coauthored churn. For landed `main` work, the corresponding shares are
29.8% and 31.5%.

The cumulative comparison covers very different periods:

- Manish: 3 active commit days across 2026-07-14 through 2026-07-18.
- Vikas-authored: 23 active days across 2026-06-10 through 2026-07-17.
- Claude-coauthored: 22 active days across the same 38-day span.

Landed churn per active day is 26,328 lines for Manish, 11,505 for
Vikas-authored commits, and 11,405 for Claude-coauthored commits. On this raw
measure, Manish's current landed pace is about **2.3x** either cumulative
baseline.

During the overlapping 2026-07-14 through 2026-07-18 window, landed churn is
78,984 for Manish, 12,332 for Vikas-authored commits, and 3,981 for
Claude-coauthored commits. Recent work types differ, so this is a throughput
comparison, not a productivity or quality score.

## Attribution caveat

Vikas and Claude are not independent buckets. Git records 127 of Vikas's 141
non-merge commits with an explicit Claude coauthor trailer. Those shared
commits account for 250,913 lines, or 94.8% of Vikas-authored churn. Adding the
Vikas and Claude totals would double-count the same commits.

The same caveat applies to Manish and Copilot: 34 of Manish's 35 landed
non-merge commits carry a Copilot coauthor trailer and account for 71,824 of
the 78,984 landed lines. A further 18 directly Copilot-authored commits changed
11,133 lines on `main`; those are not included in Manish's author total.
Unmerged Copilot checkpoint refs were excluded from pace comparisons because
they contain repeated full-tree snapshots that inflate churn.

## Method

- Identities were grouped by Git author name/email.
- Claude credit requires an explicit `Co-Authored-By: Claude ...` trailer.
- Churn is additions plus deletions from rename-aware, non-merge commit diffs.
- Merge commits are counted but receive no line total.
- “All reachable refs” includes local and fetched remote branches, deduplicated
  by commit SHA. Deleted or otherwise unreachable commits cannot be measured.
- Churn measures activity, not surviving lines, complexity, correctness,
  review quality, or delivered user value.
