---
name: pg-knowledge-loop
description: >
  Use ONLY in the PeopleGamez repo when docs/raw/ has unprocessed source files, or
  right after a successful build/TDD cycle whose learnings should be captured into
  docs/wiki/. Not for general skill discovery or workflow guidance — this is the
  PeopleGamez knowledge loop, unrelated to the superpowers plugin despite the old name.
---

# Superpowers — Knowledge Loop

You are running the PeopleGamez knowledge management loop. Execute every step in order.

## Base paths

- Raw sources: `Game Engine Dev/docs/raw/`
- Wiki pages: `Game Engine Dev/docs/wiki/`
- Wiki index: `Game Engine Dev/docs/wiki/index.md`
- Change log: `Game Engine Dev/docs/log.md`

---

## Step 1 — Scan raw/

Read `docs/raw/` directory listing.

- If empty (only `.gitkeep`): report "raw/ empty — nothing to process" and stop.
- If files present: list them and continue to Step 2.

---

## Step 2 — Read and classify each raw file

For each file in `raw/` (skip `.gitkeep`):

1. Read the full file.
2. Classify as one of: `build-log`, `spec`, `decision`, `research`, `debug-log`, `other`.
3. Identify which existing wiki page it extends (if any) or whether a new page is needed.

---

## Step 3 — Write or update wiki pages

For each raw file that needs a wiki entry:

**Format rules:**
- Max 200 words of prose per page. Use tables and bullet points — they compress better.
- Telegraphic style: drop articles, fragments OK, short synonyms. Technical terms exact.
- Structure: `# Title`, then sections as needed (`## What`, `## Why`, `## How`, `## Key facts`).
- Never copy raw content verbatim — extract the signal, discard the noise.
- If extending an existing page: append a dated `## Update — YYYY-MM-DD` section rather than rewriting.

Write the wiki file to `docs/wiki/<topic>.md`.

---

## Step 4 — Update wiki/index.md

Add or update the entry for each new/changed wiki page in the index table:

```
| Topic | [filename.md](filename.md) | One-line summary |
```

Keep the table sorted alphabetically by topic name.

---

## Step 5 — Append to docs/log.md

Add an entry at the top (below the header, above previous entries):

```markdown
## YYYY-MM-DD — <short description>

- Processed: `raw/<filename>` → `wiki/<output>.md` (NEW | UPDATED)
- <one line on what was captured>
```

---

## Step 6 — Context pruning (offer, don't auto-execute)

For each raw file that now has a verified wiki entry, ask the user:

> "Raw file `raw/<filename>` is now summarised in `wiki/<page>.md`. Delete raw source to save tokens? (y/n)"

Only delete if user confirms. Never auto-delete.

---

## Plan-Test-Code workflow (plugin integration)

When the task involves integrating a new capability or plugin:

1. **Plan**: read existing contracts/types first. Write a 3-bullet plan. Get user approval before touching code.
2. **Test**: write the test first (or acceptance scenario). Confirm it fails as expected.
3. **Code**: implement until test passes. No scope creep.
4. **Document**: after tests pass, run the knowledge loop (Steps 1–6 above) to capture any new specs or logs that landed in `raw/`.

---

## Output format

After completing all steps, report:

```
Superpowers run complete.
Raw files processed: N
Wiki pages created: X  updated: Y
Log entry added: yes
Pruning offers: Z
```

If no raw files found, report that and stop — do not fabricate wiki content.
