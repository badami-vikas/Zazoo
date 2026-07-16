---
title: DealPilot ETA, source credentials, agent/skill, and red-flag requirements
type: raw
doc_kind: requirement
status: captured
companions: [brd-dealpilot-2026-07.md, dealpilot-module-plan-2026-07.md, brd-jobpilot-2026-07.md, agent-goal-skill-orchestration-plan-2026-07.md, ui-architecture-rules-2026-07.md]
related_wiki: ../wiki/dealpilot.md
updated: 2026-07-15
tags: [dealpilot, eta, sources, credentials, agents, skills, jobpilot, red-flag]
---

In Deal Pilot, drop the user personas. Each source has an user-id and password that needs to be shown in source table in a secure way similar to passwords table of google chrome or microsoft edge. I hope the plan addresses it. If not, plan for it. 

The deal pilot shall only have Deals, Sources, Theses as pages. Overview, Summary, reports, files can never be pages in accordance with page description since they dont have data of their own and are not parallely asscoaited with multiple DBs. The rest including relaitonships, agents, etc can be a page but not are default pages. They can be converted into one if user adds. 
Also relationships exist as a colun if a relationship module exists in database. Similarly tasks (work) exists as a column if calendar module exists (which is the case since its a default module)

Isnt the capability inventory standard one? Why are we customising it to DealPilot. Only data inside a capability is customized, like activites, evalyation process, etc not the overarching structure. 

For source DB, we need space to store link, userid, password, last checked (date of time the site was last crawled) and spend cap

Also each element in a DB has a dedicated page. A Thesis should contain all thesis related data there, similarly for a source and other DBs as well. Ensure they are well defined in plan.

Let's have internal strategist as a new permanent agent so that CoS can more focus on stakeholder management and internal strategist can do all analytical works. 

Instead of so many DealPilot agents, let's leverage learning agent for all research work, CoS for all stakeholder management work, internal strategist for all analytical work on top of data sourced by learning agent and builder for any programming work and governance agent for reviews. DOes this align with the intended use of these agents? If anything is an overfit or a deviation, or any of the planned tasks is not covered, then let's build seperate agents. Based on this broader understanding, redesign the agents and skills.  

Deal Pilot is focussed on ETA.
The user is responsible for commercial data rights. Wherever explicit approval is required or onus should be highlighted to user, highlight it. 

Artefacts, Integrations etc should appear as seperate sections in deal page. Similarly integrations in source page would cover source of integrations if predefined. Else, if dynamic, skills will cover it. 

At broader platform level:
Associate skills with goals and tasks over agents so that, which certain agents have default access, based on intended goal or task, if a new agent is assigned, it should be able to pick up a skill and do it. Also each agent should be capable to create their own miniature sub-agents that inherit their skills and capabilities and work on the agent's behalf. 

The red green flags should be platform wide feedback mechanism. Let's drop green flag and have only red flag. By default, hovering on any data cell or a bullet point, a uncolored flag should subtly appear, clicking on which it should turn red. 

For job pilot, I want the learning agent to research company culture, glassdoor reviews, google reviews, reddit and blogs for insider info that can be focussed on in cover letter or interview prep. 

