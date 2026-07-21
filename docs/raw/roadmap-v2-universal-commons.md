---
title: Bridge Platform Roadmap v2 + Universal Commons (verbatim user requirement)
type: raw
doc_kind: requirement
status: under-evaluation
companions:
  - vision-pivot-living-software.md
  - client-architecture-context-providers.md
  - capability-module-format.md
related_wiki: ../wiki/roadmap.md
updated: 2026-07-06
tags: [roadmap, universal-commons, platform-agents, rag, promotion-ladder, clients, light-egg]
---

# Bridge Platform Roadmap

## Vision

Bridge is adaptive software.

Instead of asking users to configure software, Bridge learns how they work, generates the workspace they need, and continuously evolves alongside them.

Every Bridge workspace begins with the same core engine. Over time it develops its own workflows, skills, agents, tools, and interface while remaining governed, explainable, and under user control.

The user should never feel like they are training an AI or being monitored. They should simply experience software that becomes increasingly useful with normal use.

---

# Design Principles

## 1. One Engine, Many Workspaces

Bridge has one adaptive engine.

Every workspace is a specialized projection of that engine.

Examples:

* Acquisition search
* Job search
* Research
* Sales
* Recruiting
* Investing

The engine stays the same.

Only the generated workspace changes.

---

## 2. Generate, Don't Configure

Users should not spend hours creating databases, workflows or automations.

Bridge should infer them through onboarding, connected data, and observed work.

---

## 3. Learn Through Work

Bridge learns from:

* user interactions
* connected data
* successful workflows
* explicit feedback
* external knowledge

Learning is a natural consequence of work, not a separate activity.

---

## 4. Trust Before Autonomy

Every capability has:

* provenance
* confidence
* permissions
* audit trail
* governance

The system becomes more autonomous only as trust is earned.

---

# Platform Architecture

## A. Bridge Kernel

The permanent foundation.

Contains:

### Graph

Universal representation of

* objects
* relationships
* ownership
* provenance

---

### Memory

Stores

* semantic memory
* episodic memory
* procedural memory
* preferences
* decisions

---

### Governance

Controls

* permissions
* approvals
* authority
* audit
* execution policy

---

### Runtime

Executes

* workflows
* skills
* agents
* tools

---

## B. Platform Agents

Only five permanent agents exist.

### Chief of Staff

Coordinates the platform.

Responsible for

* planning
* delegation
* prioritization
* explanations
* capability recommendations

---

### Learning Agent

Learns from

* observation
* research
* user feedback
* connected systems

Builds

* user understanding
* domain understanding
* recommendations

Never executes actions.

---

### Communications Agent

Handles

* drafting
* summarization
* explanation
* reports
* meeting preparation
* documentation

---

### Governance Agent

Evaluates

* permissions
* policies
* approvals
* compliance
* risk

---

### Capability Builder

Creates new capabilities after approval.

Can generate

* workflows
* skills
* agents
* tools
* integrations
* UI extensions

---

# Workspace Generation

Every new user begins with onboarding.

## Step 1

Understand

* goals
* profession
* work style
* collaborators
* current tools
* desired autonomy

---

## Step 2

Infer domain.

---

## Step 3

Research domain.

Bridge gathers public knowledge about:

* terminology
* workflows
* lifecycle stages
* common practices
* common tools

---

## Step 4

Generate workspace.

Creates

* objects
* relationships
* tables
* pages
* views
* dashboards
* governance defaults

The workspace is a generated starting point, not a fixed template.

---

# Retrieval & Knowledge (RAG)

Bridge uses Retrieval-Augmented Generation (RAG) as its knowledge layer.

The knowledge sources include:

## Personal Knowledge

Private to the user.

Examples:

* emails
* meetings
* documents
* notes
* memories

---

## Workspace Knowledge

Shared inside the workspace.

Examples:

* documents
* workflows
* discussions
* governance
* shared knowledge

---

## External Knowledge

Retrieved when needed.

Examples:

* documentation
* APIs
* open-source projects
* industry standards
* best practices
* research papers

---

## Retrieval Strategy

Bridge combines:

* graph traversal
* semantic vector search
* structured filtering

The graph remains the source of truth.

Vectors improve semantic retrieval.

RAG provides contextual reasoning.

---

# Universal Commons

Bridge includes a cloud service called the Universal Commons.

Its purpose is **not** to collect user data.

Its purpose is to improve the platform itself.

The Commons stores only generalized capability knowledge.

Examples include:

* workflow archetypes
* reusable capability patterns
* ontology improvements
* governance heuristics
* parser improvements
* connector adapters
* onboarding improvements
* domain blueprints

No personal memories, documents, emails, conversations, or identifiable workspace data are uploaded.

The Commons continuously improves how future workspaces are generated.

---

## Example

Suppose many acquisition-search workspaces independently develop similar document intake workflows.

The Commons recognizes the common pattern and creates a reusable capability archetype.

Future acquisition-search users receive a better generated workspace without any previous user's private data being shared.

---

# Capability Lifecycle

Everything Bridge creates follows one lifecycle.

Need

↓

Research

↓

Proposal

↓

Evidence

↓

Governance

↓

Generation

↓

Execution

↓

Evaluation

↓

Improvement

↓

Retirement

Capabilities evolve continuously.

---

# Capability Evolution

Bridge promotes capabilities gradually.

User Instruction

↓

Repeated Action

↓

Workflow

↓

Skill

↓

Responsibility

↓

Agent

↓

Tool

Each promotion requires sufficient evidence and governance approval appropriate to its risk.

---

# Clients

Bridge is one platform with three clients.

## Desktop

The complete experience.

Provides:

* full workspace
* native integrations
* local execution
* file access
* screen context
* voice command center

---

## Browser

Universal access.

Provides:

* workspace access
* collaboration
* browser context
* lightweight editing

Delegates privileged native operations to Desktop when available.

---

## Mobile

Awareness and action.

Provides:

* notifications
* approvals
* voice capture
* quick updates
* summaries

---

# Command Center

Bridge includes a cross-platform command center.

Accessible through:

* keyboard
* voice
* contextual commands

The command center understands:

* current workspace
* current object
* active application
* user intent

It enables users to interact naturally without navigating menus.

---

# Product Evolution

## Phase 1 — Adaptive Foundation

Deliver:

* Bridge Kernel
* Graph
* Memory
* Governance
* Runtime
* Desktop client
* Gmail
* Calendar
* Google Docs
* Onboarding
* Workspace generation
* RAG

**Rationale**

Demonstrate that Bridge can understand a user's work and generate a useful workspace with minimal setup.

---

## Phase 2 — Learning Workspace

Deliver:

* Observation
* Signals
* Reflection
* Workflow generation
* Feedback learning
* Daily briefing

**Rationale**

Bridge should begin improving from normal usage rather than manual configuration.

---

## Phase 3 — Capability Evolution

Deliver:

* Skill generation
* Responsibility modeling
* Agent generation
* Tool generation
* Integration recommendations

**Rationale**

Repeated work becomes reusable capabilities that reduce future effort.

---

## Phase 4 — Universal Commons

Deliver:

* capability archetypes
* ontology improvements
* onboarding improvements
* reusable blueprints
* governance heuristics

**Rationale**

Every workspace helps improve how future workspaces are generated without sharing private data.

This creates a privacy-preserving network effect.

---

## Phase 5 — Interaction Expansion

Deliver:

* browser client
* mobile client
* browser extension
* voice command center
* ambient desktop context

**Rationale**

Bridge becomes available wherever work happens while maintaining one shared platform and one shared workspace.

---

# Success Criteria

Bridge succeeds when:

* users spend less time configuring software
* capabilities emerge naturally from work
* software becomes more useful over time
* users trust automation because it is transparent and governed
* every new workspace starts smarter than the last through improvements learned by the Universal Commons
* users experience increasing value without feeling that they are actively training or being monitored by the system

The ultimate goal is simple:

**Software should continuously adapt to people instead of asking people to adapt to software.**

---

Also considering I wanted a minimalistic egg, I think pushing more capabilities to bridge commons will help keep the egg light.
