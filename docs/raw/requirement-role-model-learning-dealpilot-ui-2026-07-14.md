---
title: Role-model learning, DealPilot relational cluster, and standard column/toggle menus
type: raw
doc_kind: requirement
status: recorded
companions: [egg-commons-feature-roadmap-2026-07.md, dealpilot-module-plan-2026-07.md, ui-architecture-rules-2026-07.md, ../PROGRESS.md]
related_wiki: ../wiki/index.md
updated: 2026-07-14
tags: [onboarding, learning-agent, role-models, automations, skills, dealpilot, relationships, tables, context-menu]
---

**Add an onboarding question on public figures the user admires as role models. Based on who the user lists as role models, use the learning agent to research them and recommend scheduled automations and skills on the habits, preachings or the broader life of the role model. Further, after a week of onboarding, ask the user about their favourite qualities in a person. Similarly at regular intervals, ask thoughtful questions that helps you learn more about the user at a behavioural level or even deeper. Use your learnings to deliver better value to the user.**

DealPilot:
A Deal can be associated with multiple sources or multiple thesis and a source can be associate with multiple thesis and so on. Thus all 3, Deals, Sources, Thesis, belong to the same module or sub module though they might have dedicated database.

Adding a new thesis should trigger search for new sources and a new added source should yield more new deals. Now there can be other data points associated with deal alone but not to source or thesis, like EBIDTA of a company, or username and password storage fields of sources, or CAGR of industry focus in the thesis.


Right clicking a column should show add page / remove page as one of the options, if and only if the source has a DB associated with it, which adds a toggle page. Other options should include all standard options available in notion. The same add and remove page option should be available on right clicking toggle.

(
Inline edit name option
Edit Column
Change type dropdown
AI Smartfill toggle
Filter
Sort
Group
Calculate
Lock Column
Hide Column
Add column to left
Add column to right
Duplicate Column
Delete Column
)

While I described the UI interns of deal pilot, this should be standard structure for all modules. Convert above info into tasks and add them to roadmap. Then commit and push
