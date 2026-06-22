---
title: Helpdesk — Requirement (verbatim, as supplied by the user 2026-06-03)
type: raw
doc_kind: requirement
status: active
companions: [helpdesk-plan.md]
related_wiki: wiki/helpdesk.md
updated: 2026-06-22
tags: [helpdesk, requirement, verbatim]
---
# Helpdesk — Requirement (verbatim, as supplied by the user 2026-06-03)

> Saved as-is for future reference. Bridge's architectural interpretation + build plan
> live in `helpdesk-plan.md` (raw) and `../wiki/helpdesk.md` (caveman). This file is the
> source of truth for intent.

---

## Helpdesk

### Vision
Bridge AI Helpdesk is an AI-mediated assistance system that intelligently routes requests to people who can potentially help, while minimizing noise for everyone else.

Rather than publishing requests to a feed and hoping the right people see them, every request is evaluated against the capabilities of potential helpers and delivered only where meaningful assistance may be possible.

### Architecture
There are three layers:

**Layer 1: Help Requests**
A user expresses a need.
Examples:
* Looking for internship advice
* Need feedback on a startup idea
* Need help understanding a math concept
* Looking for recommendations
* Need introductions
* Need resources
* Need expertise

The platform does not classify requests by predefined workflows.
Everything is simply:
```
I need help with X.
```

**Layer 2: Helpdesk AI**
The AI evaluates:
* What the requester needs
* Who might be able to help
* How they might be able to help

The AI is not limited to predefined actions.
It can identify:
* Advice
* Expertise
* Resources
* Referrals
* Feedback
* Connections
* Experience
* Recommendations
* Knowledge

or any other form of assistance it infers.

**Layer 3: Human Helpers**
People ultimately decide whether to assist.
The AI facilitates discovery and proposes possible assistance paths.
Humans remain in control.

### Routing Modes

**Mode 1: AI-Assisted Routing (Default)**
This should be the default and primary experience.

Request Flow
User submits:
> Looking for climate-tech internship opportunities.

The request is never broadcast directly.
Instead, each recipient's Helpdesk AI independently evaluates:
1. Can this person help?
2. Why might they be able to help?
3. What assistance might they provide?

Recipient Experience
Instead of:
> Vikas posted a request.

They see:
> Bridge AI believes you may be able to help.

Possible ways you could assist:
* Share internship opportunities
* Recommend organizations
* Provide recruiting advice
* Review application materials

The AI proposes actions rather than merely suggesting relevance.

Invisible by Default
If the recipient's AI cannot identify meaningful ways they could contribute:
```
Request not shown.
```
No feed clutter.
No notification fatigue.
No irrelevant requests.

**Mode 2: Broadcast Mode**
Broadcast mode intentionally overrides selective routing.
The requester explicitly chooses:
```
Broadcast to all connections
```
Every connection becomes eligible to receive the request.

Capability-Based Filtering
This is where your clarification matters.
The filtering should not be topic-based.
Instead:
```
Can this recipient contribute?
```
not
```
Does this recipient like this topic?
```
A startup founder may still be able to help with:
* hiring
* fundraising
* networking
* operations
even if the request isn't categorized as "startups."

AI Auto-Filter
If enabled:
The recipient's AI evaluates every incoming broadcast request.
Requests that appear unlikely to benefit from the recipient's involvement are hidden automatically.
The result:
* Requesters get broad reach
* Recipients avoid noise

### Helpdesk AI Behavior
The AI should not be a chatbot.
It should act as a support strategist.
For every request it attempts to answer:
"How could this person realistically help?"

Examples:
* Suggested Response Draft — AI drafts a possible reply.
* Suggested Resource — AI identifies relevant resources.
* Suggested Expertise — AI explains why the recipient may be qualified.
* Suggested Next Step — AI recommends a concrete action.
* Suggested Contact — If the recipient wishes, AI may suggest relevant people already known to them.

These are not separate features.
They are simply different outputs of Helpdesk AI reasoning.

### Custom Helpdesks (Public Workspaces)
This is effectively a multi-tenant helpdesk system powered by Bridge AI.

Workspace Creation
Any Bridge AI user may create:
```
Helpdesk Workspace
```
Examples:
* Entrepreneurship Hub
* MBA Cohort
* Startup Accelerator
* Math Study Group
* Product Leadership Circle

Workspace Components
Each workspace contains:
* Name
* Description
* Custom URL
* Branding
* Visibility Rules
* Access Rules
* Help Requests
* Workspace Members

Workspace Owner
The creator becomes:
```
Workspace Admin
```
Admin capabilities:
* Manage requests
* Manage access
* View all submissions
* Moderate content
* Resolve identity disputes

Public Helpdesk Experience
A public helpdesk is simply a workspace exposed through a shareable URL.
Example:
```
bridge.ai/help/entrepreneurship-hub
```
Visitors do not need Bridge accounts.

Public Identity Model
When posting:
Required:
* Name
* Email
Optional:
* Phone

Contact Preferences
Requester chooses:
Allow Direct Contact
If enabled:
Show:
* Email
* Phone
* Both
to helpers who click:
```
Offer Direct Help
```

Private Contact Mode
If disabled:
Helpers must submit:
```
How I can help
```
The requester sees:
* Helper name
* Contact information
* Response
Public visitors see neither.

Public Visibility Rules
Public viewers can see:
* Request title
* Request description
* Status
* Number of helpers
Public viewers cannot see:
* Requester identity
* Requester contact details
* Helper identities
* Helper contact details
* Private responses
This protects both sides.

### Session Management
For frictionless participation:
Returning User Access
A user regains access by entering:
* Same Name
* Same Email
used during creation.

Access Failure
If the information does not match exactly:
Access is denied.

Admin Resolution
Workspace admins can:
* View original submission data
* Verify identity manually
* Correct typos
* Issue access overrides
This keeps onboarding lightweight while still allowing recovery.

### Security & Abuse Prevention
CAPTCHA
Mandatory on all public-facing forms:
* New requests
* New replies
* Contact submissions

Rate Limiting
Prevent:
* spam posting
* automated scraping
* mass responses

AI Moderation
Detect:
* scams
* harassment
* malicious links
* spam
before publication.

### Workspace Dashboard
Inside Bridge AI:
```
My Helpdesks
```
Example:
* Entrepreneurship Hub
* Board Game Club
* MBA Cohort
* Startup Accelerator

For each workspace:
* Active requests
* Resolved requests
* Pending responses
* Helper activity
* Workspace members

### Future Enhancements
These should remain explicitly outside the MVP.

AI Auto-Filter Tuning
Allow users to teach the AI:
* Show more requests like this
* Show fewer requests like this

Capability Learning
Helpdesk AI continuously improves understanding of:
* what users know
* what users can do
* how users typically help others

Cross-Workspace Discovery
Allow AI to identify relevant assistance opportunities across multiple workspaces while respecting workspace permissions.

---

The strongest positioning statement I see is:
**Bridge Helpdesk is an AI-mediated assistance network that routes requests to people who can help, proposes actionable ways they can contribute, and eliminates the noise of traditional feeds and forums.**
