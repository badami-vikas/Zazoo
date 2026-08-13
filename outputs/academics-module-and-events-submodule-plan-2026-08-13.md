# Academics Module + Events sub-module — design, automations, and OSS intake

Date: 2026-08-13 · Tier C (new Module rows, cross-plane egress, canon vocabulary)
Status: **plan, not built.** Needs an APPROVALS row before any manifest edit.
Free IDs at time of writing: TASK-067+, ADR-231+, AP-149+.

---

## 0. Two corrections to the brief, up front

**"Similar to the dice conference process" — that process does not exist in this repo.**
Exhaustive grep of the worktree (`platform/`, `docs/`, `outputs/`, `Tools/`, and `git log --all --grep`):

- `dice` / `Dice` only ever means the **Dice coefficient**, a trigram string-similarity score —
  `platform/packages/dedupe/src/scoring.ts:1`, `platform/modules/jobpilot/src/answer-bank.ts:6`,
  `docs/wiki/tools.md:30`.
- `conference` appears only as an **unbuilt future Tool** — `platform/tools/recorder/package.json:6`
  ("a future Conference tool mounts this without owning recording/transcription code"),
  `docs/raw/calendar-plan.md:270` (phase "Conference / event integrations", exit criterion unmet).
- `speaker` only ever means an audio output device.
- No TASK, no ADR, no branch, no commit.

So there is no prior process to mirror. The extraction pipeline in §4 is designed from scratch —
but it is deliberately built on top of governance this repo *does* already have (the three-tier
match rules and the draft-then-approve staging the WhatsApp Contact Extractor uses).

If "dice" meant something outside this repo — a tool you use, or an earlier session — say so and I
will align to it.

**LinkedIn connection requests cannot be fully automated, and this plan does not pretend otherwise.**
See §5. Short version: no LinkedIn API exposes invitations, their User Agreement prohibits automated
access, and this repository already codified that position — `Tools/recon-salvage-2026-08-03/README.md:192`
reads "LinkedIn is never fetched directly (ToS / anti-scrape)." The design is a **draft-then-send
queue with a human on every invite**, which is the same pattern Gmail egress and WhatsApp sending
already use here. I will not build an unattended bulk-invite sender.

---

## 1. What already exists (so nothing gets rebuilt)

| Thing | Where | Relevance |
|---|---|---|
| Module registry | `platform/modules/manifests/src/index.ts:657-1102` (`BUILT_IN_MODULES`) | Both new Modules are entries here |
| Catalog assertion | `platform/modules/manifests/test/catalog.test.ts:13` | Hard `deepEqual` on the name list — fails until updated |
| Sub-module mechanism | `ModuleSurfaceManifest.parentModule`, ADR-178 | Nav only. Grants **no** permission, credential, or plane relaxation |
| Sub-module precedents | `helpdesk` (`:868`), `whatsapp` (`:926`) | Helpdesk ships *zero* code — a manifest entry, a route, a page |
| NetworkManager | `name: "relationship"`, displayName **NetworkManager**, `/module/relationship` | Parent of the new Events sub-module |
| Draft-then-approve staging | `platform/modules/whatsapp/src/{send,outbound,policy}.ts` | Reuse wholesale for both new automations |
| Match governance | your 3-tier rule (strong / moderate / flag) | Reused verbatim for speaker resolution |
| Academics anything | **nothing** | Greenfield |
| LinkedIn anything | **nothing in `platform/`** | Greenfield, and constrained — §5 |

---

## 2. Academics Module

`name: "academics"` · `displayName: "Academics"` · `version: "0.1.0"` · route `/module/academics/subjects`

### 2.1 Why three toggles, not "Lecture Sessions inside Subjects"

You asked for Subjects "inside which I can add and manage lecture sessions". Your own UI canon
(`docs/wiki/ui-architecture.md`) decides this:

- Toggles are **one level**, and the data-shape rule says *different columns, same strong sibling
  cluster → TOGGLE*. Subjects, Lecture Sessions and Assignments have genuinely different columns.
- "Record Detail: every DB row gets routable detail. Relations/Files/Results = Sections."

So: **three sibling toggles** — Subjects · Lecture Sessions · Assignments — and a Subject's Record
Detail carries its Lecture Sessions and Assignments as related Sections. You get the "inside
Subjects" experience without inventing a second nav level that the nav builder would flatten anyway.

The vault framing you described is exactly what the Module already is: everything lands in
`~/Documents/Bridge/<Organization>/Academics/`, local-first, per the Local Files rule.

### 2.2 Pages / Databases

**Subjects** — `academics.page.subjects`, `readPrivate("record") + writePrivate("record")`

| Column | kind | notes |
|---|---|---|
| code | text | locked, e.g. `CS-6035` |
| title | text | |
| term | select | Fall 2026, Spring 2027, … |
| instructor | relation → `people` | reuses NetworkManager People, not a second person store |
| credits | number | |
| status | select | planned / active / complete / dropped |
| grade | text | |
| target_grade | text | drives the workload Signals in §2.5 |

**Lecture Sessions** — `academics.page.lecture-sessions`

| Column | kind | notes |
|---|---|---|
| subject | relation → subjects | the "inside" link |
| session_date | date | calendar + timeline views come free |
| topic | text | |
| status | select | scheduled / attended / missed / reviewed |
| recording | file | Local Plane only, never mirrored to Cloud |
| transcript | text | whisper.cpp output, word-timestamped |
| my_notes | text | the sparse notes *you* type live |
| synthesis | text | generated — see the Hyprnote trick in §2.4 |

**Assignments** — `academics.page.assignments`

| Column | kind | notes |
|---|---|---|
| subject | relation → subjects | |
| title | text | |
| type | select | problem set / essay / project / exam / lab |
| due_at | date | |
| weight | meter (0..100) | uses the existing `display: "meter"` hint (ADR-155) |
| status | select | not started / in progress / submitted / graded |
| risk | rag | red/yellow/green — **domain** signal, not a feedback flag (AP-023 stands) |
| submitted_at | date | |
| grade | text | |
| artifacts | file | |

Default views: Subjects → table; Lecture Sessions → **calendar** (`dateBy: session_date`);
Assignments → **board** grouped by `status`, plus a calendar on `due_at`. All eight view kinds are
already in the registry, so this is config, not code.

### 2.3 Agent

One Agent, `academics.agent.study-steward` ("Study Steward"), `plane: "local"` — lecture audio and
transcripts are raw capture and stay Local by principle.

Skills are declared **under** it (canon: Skills never get a Page, and only an attributable allowed
Agent invokes them).

### 2.4 Skills

| Skill | Does | Built on |
|---|---|---|
| `academics.skill.lecture-synthesis` | Turns a transcript **conditioned on your sparse typed notes** into structured notes — not a summary of the transcript alone | Hyprnote's core idea (GPL-3.0, borrow-only); whisper.cpp for the transcript |
| `academics.skill.syllabus-intake` | Syllabus PDF/DOCX → draft Assignment rows with dates and weights, staged for approval | Docling (MIT) for layout-aware PDF→structure |
| `academics.skill.recall-scheduler` | Generates recall cards from lecture notes and schedules them | **`ts-fsrs` (MIT, zero-dep TypeScript)** — see §6, this is the single highest-value integration in the whole plan |
| `academics.skill.reference-resolve` | Cite-as-you-write: resolves a reference against your existing Zotero library and Crossref/OpenAlex | Zotero local HTTP API + CSL-JSON; Better BibTeX pinned citekeys |
| `academics.skill.workload-forecast` | Given due dates, weights and your target grades, says what's actually at risk this week | pure data, no egress |

Why FSRS specifically: card state is four scalars (`stability`, `difficulty`, `due`, `state`) plus a
review log. **That review log is already a Bridge Event/Signal stream** — you store nothing new
structurally, and the optimizer trains personal parameters from your own history. `ts-fsrs` is MIT
and dependency-free, so it drops straight into the monorepo.

### 2.5 Automations

| Automation | Trigger | Writes | Plane |
|---|---|---|---|
| `syllabus-intake` | Manual, on file drop into the Module folder | Draft Assignments (approve to commit) | Local |
| `lecture-capture` | Desktop sensor: recording finished | Draft Lecture Session + transcript + synthesis | **Local only** |
| `deadline-sweep` | Daily cadence | Signals for assignments <48h out and still "not started"; sets `risk` RAG | Local |
| `review-queue` | Daily cadence | Today's FSRS-due cards as a roll-up | Local |
| `lms-sync` | Cadence, **only if you use Canvas/Moodle** | Assignments from the LMS API + ICS deadlines | Cloud, egress:true, declared |

`lecture-capture` reuses `platform/tools/recorder/` — the package comment already anticipates a
consumer mounting it "without owning recording/transcription code."

Deliberately **not** automated: nothing auto-marks an assignment submitted, and nothing auto-grades.
Both are judgements.

---

## 3. Events sub-module

`name: "events"` · `parentModule: "relationship"` · route `/module/relationship/events` ·
`displayName: "Events"` · `version: "0.1.0"`

Sits under NetworkManager beside Helpdesk and WhatsApp. Nesting is nav only — it declares its own
capability and its own trust lifecycle.

**One Page, one Database.** Columns: `name`, `url`, `type` (conference / meetup / summit / webinar),
`starts_at`, `ends_at`, `location`, `status` (watching / registered / attending / attended),
`speakers` (relation → **people**), `extraction_status`.

**There is deliberately no Speakers table.** Speakers resolve into NetworkManager People with an
Event→Person edge. A second people store inside a relationship product would defeat the product.
Consequence: the Events capability must declare `readPrivate("person") + writePrivate("person")`
itself — `parentModule` grants nothing, per ADR-178.

---

## 4. Automation A — speaker extraction

Trigger: **manual, per Event URL.** Not a crawl cadence. One page fetch per event you actually care
about keeps this defensible on robots.txt and rate-limit grounds.

```
Event.url
  → fetch + extract      trafilatura (Apache-2.0) or self-hosted Crawl4AI (Apache-2.0)
                         with a per-site CSS schema, generated once by an LLM then
                         re-run deterministically each year — no per-page LLM cost
  → typed rows           { name, talk_title, affiliation, session, time, bio_url }
  → resolve identity     OpenAlex /authors?search= filtered by ROR institution + topic
                         ORCID as the authoritative override
                         Crossref for proceedings DOIs
  → YOUR 3-tier gate     strong  = name + ≥1 corroborating point  → auto-stage Person
                         moderate= name only                      → in-profile pending
                         weak    = neither                        → flag, no write
  → writes               draft People · Event→Person edges · one Signal per run
  → approve              same draft-then-approve UI the WhatsApp Contact Extractor uses
```

Two things worth stealing, both confirmed by the research:

- **OpenAlex publishes its disambiguation feature set**: name similarity, co-author overlap,
  institutional affiliation, topical coherence, citation patterns, ORCID override. That six-factor
  scheme maps cleanly onto your existing three tiers — reimplement the scoring, don't port the
  pipeline (it's Databricks-shaped).
- **OpenAlex assigns `A9999999999`** to authorships it refuses to disambiguate rather than guessing.
  That is *exactly* your "ambiguous duplicates become Signals, never auto-merge" rule, independently
  arrived at by a 477M-record system. Good external confirmation, and a ready-made sentinel value.

Caveat to budget for: OpenAlex moved to **credit-metered API pricing in Q1 2026** (singleton = 1
credit, list = 10, vector search = 1000) and is mid-rewrite of author disambiguation. Free keys
exist; at conference-agenda volume you are nowhere near a problem, but pin the client.

---

## 5. Automation B — LinkedIn connection requests (the honest version)

**What is not possible, and why I'm not building it:**

- No LinkedIn API — including the Partner APIs — exposes sending connection invitations.
- LinkedIn's User Agreement prohibits automated access, scraping, and bots. Automated invite
  sending is the single most reliably detected and restricted behaviour on the platform.
- This repo already took that position: `Tools/recon-salvage-2026-08-03/README.md:192` —
  "LinkedIn is never fetched directly (ToS / anti-scrape). Recon reads only the public SERP snippet."
- Bridge canon points the same way: every outbound path in this codebase today (Gmail egress,
  WhatsApp send) is **draft-then-approve**, and there is no unattended external-send capability
  anywhere in `platform/`.

**What I will build instead — an outreach queue:**

```
approved Speaker (a Person, from §4)
  → draft note        personalised from the extracted bio + your existing Signals with them
                      (met at X, shared community Y, their talk was on Z)
  → queue row         { person, profile_url, draft_note, status, sent_at }
  → you click through one at a time; the note is on your clipboard / prefilled
  → you press Send on LinkedIn yourself
  → mark sent         writes a Signal so the interaction lands in the graph
```

Optional later upgrade, still human-per-invite: the desktop companion opens each profile in sequence
and prefills the note field; you press Send. That is assistive, not bulk automation, and it keeps a
human decision on every single invite. It is also the same shape as the WhatsApp session already
running inside the Tauri shell, so the mechanism exists.

The genuine value here is **the drafting and the sequencing**, not the clicking. Fifty personalised
notes written from real context is the hard part; fifty clicks is not.

---

## 6. Open-source intake

Full comparison researched separately; this is the shortlist that actually earns a place.

### Integrate directly — has an API, CLI, or open format

| Project | Licence | Use |
|---|---|---|
| **ts-fsrs** | MIT | Spaced-repetition scheduling. Zero-dep TS, ~93k weekly downloads, v5.4.1. **Do this one first.** |
| **whisper.cpp** | MIT | On-device lecture transcription for the Tauri shell. No Python. |
| **WhisperX** | Apache-2.0 (models gated) | transcribe → force-align → diarize. Gives word timestamps + "lecturer vs Q&A" |
| **Docling** | MIT | Syllabus/paper PDF → structured model with layout and tables (IBM, ~30k★) |
| **Zotero** local API + CSL-JSON | AGPL-3.0 | Read the library you already have instead of re-entering 400 references. Zotero 8 shipped; 9 in beta |
| **Better BibTeX** | MIT | Pinned citekeys — stable human-meaningful IDs that survive sync. ≥8.0.26 drops Zotero 7 |
| **Canvas REST API + ICS** | AGPL-3.0 (server) | `/users/self/todo`, `/courses/:id/assignments` with `due_at`/`points_possible`. Real deadlines, zero scraping |
| **Moodle Web Services** | GPL-3.0 | Same, if your institution runs Moodle |
| **OpenAlex · ORCID · Crossref · ROR** | CC0 / free | Speaker identity resolution (§4). OpenAlex now credit-metered |
| **Crawl4AI** / **trafilatura** | Apache-2.0 | Agenda-page extraction. Crawl4AI for schema'd extraction, trafilatura when you just want clean text |
| **AnkiConnect** | GPL-3.0 | Only if you'd rather drive an installed Anki than build a reviewer UI |

### Borrow the idea, not the code

- **Hyprnote** (GPL-3.0, ~10k★, YC S25) — summarize the transcript *conditioned on the sparse notes
  the human typed*. Best product idea in the whole category and cheap to reimplement. §2.4 uses it.
- **Trilium** (AGPL-3.0, 37.4k★) — inheritable typed attributes + relations on notes. Nearly a
  drop-in design for Module Relations, and it has a real REST API (ETAPI) if you want interop.
- **SiYuan / Logseq** — block-as-atomic-addressable-unit with a queryable index. Logseq's 3-year
  file→DB migration (2.0.1 beta, 2026-07) is a live case study in what that architecture costs.
- **Vikunja** (AGPL-3.0) — one task model, five views. Direct precedent for your data-shape rule.
- **Sioyek** — "portals": a persistent split-view linking a citation to the referenced figure.
- **SurfSense** (Apache-2.0) — best-documented free RAG design: two-tier hierarchical indices +
  hybrid semantic/full-text fused with Reciprocal Rank Fusion. You already have pgvector.
- **Obsidian vault convention** — plain `.md` + `[[wikilinks]]` in the Module folder buys PKM-
  ecosystem interop for free. (Obsidian itself is proprietary; only the format is worth copying.)

### Stale — read, don't depend on

**Amurex** (last release 2025-03) · **Focalboard** (archived by Mattermost) · **Sioyek** (2025
snapshot, author stepped back) · **Reor** (cadence thinning) · **Logseq plugin API** until the 2.0
split settles.

### Licence landmines

**AGPL-3.0 is network-copyleft and you have a Cloud Plane** — matters for Firecrawl, Planka, and
most of the PKM tier if you ever *embed* rather than call them. **AFFiNE**'s sync server is
proprietary EE despite the MPL client. Per your clean-room protocol, anything restricted gets
behaviour-benchmarked and independently authored, and the researcher doesn't implement the
alternative.

---

## 7. Best practices worth encoding as governance, not prose

1. **Raw lecture capture never leaves the Local Plane.** Transcripts and derived notes may sync;
   audio does not. This is your existing principle, applied.
2. **Every generated note keeps its provenance edge** to the transcript span that produced it, with
   word-level timestamps. "Jump to the moment the professor said X" falls out for free, and an
   unsourced claim in your notes is visibly unsourced.
3. **Nothing auto-grades and nothing auto-marks-submitted.** Both are judgements; automations report
   and stop — the same line ADR-201 drew for the Task Manager cadence automations.
4. **Speaker extraction writes drafts only.** A moderate-confidence match is a pending Signal, never
   a merged Person. Adopt OpenAlex's refusal sentinel rather than a confidence threshold that guesses.
5. **One outbound invite = one human decision.** No batch send, ever.
6. **FSRS parameters are personal data derived from your review log** — Local Plane, and the review
   log is the Memory the capture creates. Every capture creates inspectable Memory.
7. **Cite at capture time, not at writing time.** `reference-resolve` on the lecture, so the citation
   exists before the essay does.
8. **Term rollover is an archive, not a delete.** Completed Subjects stay queryable — the Second
   Brain graph across four years of coursework is the actual long-term asset here.

---

## 8. Build sequence

Governance first: this is Tier C. New Module rows are canon → **APPROVALS row (AP-149) before any
manifest edit**, plus an ADR (ADR-231) recording the three-toggle decision, the no-Speakers-table
decision, and the LinkedIn draft-only position with its rejected alternative.

| Phase | Work | Notes |
|---|---|---|
| **P0** | AP-149 + ADR-231 + TASK-067/068 rows | Nothing else starts first |
| **P1** | Academics manifest entry, 3 pages, routes, page components, catalog test | Mirrors Helpdesk: mostly manifest + routes. Ships with honest empty states |
| **P2** | Events sub-module manifest + page + route | Smaller than P1 — one Page |
| **P3** | Speaker extraction: fetch → typed extract → OpenAlex resolve → 3-tier gate → draft People | Reuses WhatsApp staging wholesale |
| **P4** | Outreach queue + note drafting; human sends | No unattended egress capability declared |
| **P5** | `ts-fsrs` recall scheduler + review-queue automation | Highest value-per-line in the plan |
| **P6** | Lecture capture: recorder + whisper.cpp + notes-conditioned synthesis | Local plane, desktop only |
| **P7** | LMS sync (Canvas/Moodle) — **only if you actually use one** | First declared egress in this Module |

P1+P2 are genuinely small — Helpdesk proves a sub-module can ship with zero package code. P3 and P6
are the real engineering.

---

## 9. Open question

What did "dice conference process" refer to? Nothing in this repo matches, and if it was a working
pattern you have elsewhere, §4 should be aligned to it rather than invented.
