---
title: Bridge Client Architecture + Context Providers (verbatim user requirement)
type: raw
doc_kind: requirement
status: adopted
companions:
  - vision-pivot-living-software.md
related_wiki: ../wiki/clients.md
updated: 2026-07-06
tags: [clients, desktop, browser, mobile, context-providers, sensors, voice, onboarding]
---

Bridge should have many context providers:

Apps

↓

Accessibility

↓

Screen

↓

Voice

↓

Clipboard

↓

Filesystem

↓

Browser

↓

Documents

↓

Emails

The Learning Agent consumes context, not screenshots.
That abstraction will make your architecture much cleaner and let you swap providers


Bridge Client Architecture
Vision
Bridge is a single adaptive work platform.
Users should never think they are using different products.
They should simply be using Bridge.
Desktop, Browser, and Mobile are different interaction surfaces over the same underlying system.
Every workspace, capability, workflow, skill, agent, tool, memory, graph, and governance rule belongs to the same platform.
The client only determines how users interact with Bridge, never what Bridge fundamentally is.

Architecture
                   Bridge Platform

        Graph • Memory • Governance
       Capability Engine • Runtime
      Workflows • Skills • Agents
         Tools • Integrations • APIs

                    ▲
      ┌─────────────┼─────────────┐
      │             │             │
  Desktop        Browser       Mobile
There is only one platform.
Three clients.

Desktop
Role
Primary Workspace
Desktop is the complete Bridge experience.
It is both
* the primary user interface
* the local execution environment
If Bridge can do something, it should be possible from the desktop.

Responsibilities
Workspace
* Tables
* Pages
* Dashboards
* Graph
* Timeline
* Threads
* Reports

Capability Management
* Workflows
* Skills
* Agents
* Tools
* Integrations

Governance
* Policies
* Permissions
* Approvals
* Audit

Local Context
Desktop owns native operating-system capabilities.
Examples
* Local filesystem
* Screen context
* Accessibility APIs
* Clipboard
* Voice hotkey
* Notifications
* Local AI models
* Native integrations

Execution
Desktop acts as the preferred execution runtime for local capabilities.
Examples
* Local connectors
* Local scripts
* Native tools
* Screen understanding

Desktop Principle
Desktop is the reference implementation of Bridge.

Browser
Role
Universal Access
Browser provides Bridge anywhere.
The browser is not a lightweight product.
It is the same platform running inside browser constraints.

Responsibilities
Daily Work
* View workspaces
* Edit objects
* Search
* Review signals
* Run workflows
* Communicate
* Create capabilities

Collaboration
* Shared workspaces
* Team collaboration
* Comments
* Reviews
* Sharing

Browser Context
Browser-specific capabilities
* Current tab
* Selected text
* Browser extension
* Web applications

Delegation
When browser requires privileged native capabilities, it delegates execution to Desktop if available.
Examples
* Screen context
* Local filesystem
* Native applications

Browser Principle
Browser provides maximum reach while remaining a first-class Bridge experience.

Mobile
Role
Awareness and Action
Mobile is optimized for staying connected to work while away from the primary workspace.

Responsibilities
Capture
* Voice notes
* Quick notes
* Photos
* Documents
* Contacts

Awareness
* Notifications
* Signals
* Open threads
* Daily briefing
* Upcoming work

Decisions
* Approvals
* Rejections
* Governance requests
* Workflow execution

Communication
* Quick replies
* Calls
* Meeting preparation
* Follow-ups

Mobile Principle
Mobile minimizes interaction cost while maximizing responsiveness.

Voice Command Center
Bridge includes a cross-platform command center.
Users invoke it through a configurable global shortcut (for example, holding the Fn key on supported devices) or other platform-appropriate triggers.
The command center understands
* current workspace
* current page
* selected object
* active application
* current document
* user intent
Examples
Summarize this meeting.
Build a workflow from this.
Research this company.
Explain why this signal exists.
Draft a reply.
Turn this into an agent.
The command center behaves consistently across Desktop, Browser, and Mobile.
Only available capabilities differ depending on platform permissions.

Client Responsibilities
Capability	Desktop	Browser	Mobile
Full workspace	✓	✓	✓
Graph	✓	✓	✓
Memory	✓	✓	✓
Search	✓	✓	✓
Tables & Pages	✓	✓	✓
Dashboards	✓	✓	✓
Workflows	✓	✓	Review & Run
Skills	✓	✓	View
Agents	✓	✓	View
Governance	✓	✓	Approvals
Voice Commands	✓	✓	✓
Notifications	✓	✓	✓
Native File Access	✓	Limited	Limited
Screen Context	✓	Browser-only context	No
Accessibility APIs	✓	No	No
Local AI Runtime	✓	No	Limited
The goal is not feature parity.
The goal is a consistent platform experience.

Interaction Philosophy
Desktop provides depth.
Browser provides reach.
Mobile provides accessibility.
All three operate on the same platform.

Guiding Principles
One Platform
Bridge exists once.
Every client connects to the same adaptive platform.

Desktop First
Desktop provides the complete experience and hosts native capabilities.

Browser Everywhere
Browser brings the complete workspace to any device while leveraging browser-native context and delegating privileged operations when necessary.

Mobile Anywhere
Mobile enables quick capture, awareness, approvals, and communication.

Shared Intelligence
Every client shares
* Graph
* Memory
* Governance
* Workflows
* Skills
* Agents
* Tools
* Signals
* Capabilities
Learning in one client immediately benefits every other client.

Native When Possible
Each client uses the strengths of its environment.
Desktop leverages the operating system.
Browser leverages the web.
Mobile leverages portability.
No client is a separate product.

Product Principle
Users should never think
"I'm using Bridge Desktop."
or
"I'm using Bridge Web."
They should simply think
"I'm using Bridge."
The platform remains identical.
Only the interaction surface changes.


Also, onboarding is a pop up screen
