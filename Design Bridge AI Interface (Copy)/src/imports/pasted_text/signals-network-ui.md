I still see People organization and industry in header of central section of all pages and in place of lists, I'm seeing the toggle that should ideally appear in header. 

Make the first toggle under network as signals followed by people and communities. 

Signals (NEW PRIMARY ENTRY)

Signals is the default landing surface for Network.

It is not a database view.

It is a decision surface.

It answers:

“What relationship actions matter right now?”

Signal Types
Dormant Relationship Reconnect
Introduction Opportunity
Help Opportunity
Hiring / Fundraising Activity
Community Movement
Event / Conference Overlap
Role Change Detection
Signal Structure

Every signal follows:

Signal → Context → Insight → Action

Every signal must produce at least one actionable recommendation.

No passive signals allowed.

I want workspace dropdown on left nav bar to show different workspaces I'm part of, options to select and modify accounts (all functions similar to the workspace dropdown in notion)

Wherever relevant, introduce:
Row interactions
Single click row select
Double click cell edit
Open row as full-page modal/side peek/full page
Multi-select rows
Shift-select range
Cmd/Ctrl select additive selection
Drag reorder rows
Drag rows across groups/views
Duplicate row
Delete/archive row
Inline row creation
Keyboard row creation (Shift+Enter patterns etc.)
Cell interactions
Inline editing
Formula rendering
Rich text inside cell
Copy/paste multi-cell
Autofill drag
Multi-cell selection
Column-wide edit
Batch edit selected rows
Property type conversion
Mention/page linking
Relation picker dropdown
2. Property / Column Type Interactions

This is where Notion becomes a lightweight relational DB.

Text
Plain text
Rich text
Mentions
Slash commands
Markdown shortcuts
Number
Currency formatting
Percent formatting
Progress bars
Aggregation footer
Select / Multi-select
Colored tags
Inline creation of new options
Drag reorder tags
Keyboard quick-add
Status
Workflow grouping
Kanban drag transitions
Auto-color states
Date
Date picker
Range selection
Relative dates
Recurring logic
Timeline drag-resize
Person
Avatar picker
Team filtering
Mention syncing
Checkbox
Toggle inline
Batch toggle
Trigger automations
URL / Email / Phone
Hover preview
Open externally
Smart formatting
Files
Drag upload
Paste image/file
Gallery preview
Cover image selection
Relation
Search linked records
Inline create linked item
Bidirectional sync
Drag-to-link interactions
Relation filtering
Rollup
Aggregation previews
Nested relation traversal
Dynamic recalculation
Formula
Live recalculation
Formula autocomplete
Type inference
Property references
Nested expressions
Relation traversal
Button
Trigger automations
Open pages
Create records
API/webhook actions
3. View-Level Interactions

This is arguably Notion’s strongest UX layer.

Table View
Resize columns
Hide/show columns
Freeze first column
Sort
Filter
Group
Inline calculations
Sticky headers
Infinite scroll
Quick property editing
Board / Kanban View
Drag card between columns
WIP grouping
Collapse columns
Swimlanes
Card preview density
Inline card editing

Dragging across filtered views automatically updates properties — one of Notion’s most addictive interactions.

Calendar View
Drag event across dates
Resize duration
Month/week/day toggle
Overlay multiple DBs
Timeline/Gantt
Zoom scale
Dependency visualization
Drag ranges
Milestone markers
Gallery View
Card sizing
Cover image focus
Quick preview
Masonry layouts
List View
Compact display
Expand/collapse groups
Keyboard navigation
4. Database Structure Interactions
Create linked database
Same data, different view
Shared filters/sorts
Independent layouts
View switching
Tabs
Persisted view state
Personal vs shared views
Filter builder
AND/OR nesting
Dynamic filters
Relative filters (“assigned to me”)
Sort builder
Multi-sort hierarchy
Drag reorder sort priority
Grouping
Nested grouping
Collapsible groups
Drag regrouping
Templates
Default templates
Per-status templates
Dynamic placeholders
Template buttons
5. Page + Block Hybrid Interactions

This is what differentiates Notion from Airtable/Excel.

Every row is also a page.

Record-as-page
Open row into document
Nested blocks inside row
Comments/discussions
AI summaries
Subpages
Block editing
Drag block
Nested blocks
Slash commands
Turn block into another type
Inline embeds
Toggle blocks
Drag-and-drop blocks
Reparent hierarchy
Nesting
Cross-page movement
Duplicate via modifier key drag
6. Collaboration Interactions
Multiplayer editing
Presence cursors
Live updates
Conflict resolution
Comments
Inline comments
Database row comments
Mentions
Resolved threads
Notifications
Property changes
Mentions
Assigned tasks
Reminder triggers
7. Automation Interactions
Trigger-based automations
On create
On edit
Status changes
Date reached
Actions
Update property
Create page
Send webhook
Notify user
Connect integrations
Formula automations
Derived relations
Computed workflows
Cross-database propagation
8. Keyboard Interaction System

Notion’s keyboard UX is elite and critical to perceived speed.

Navigation
Arrow navigation
Cmd/Ctrl+K quick search
Cmd/Ctrl+P quick jump
Enter to open
Escape to exit
Editing shortcuts
Markdown transforms
Slash commands
Cmd/Ctrl+B/I/U
Duplicate blocks
Move blocks via keyboard
Database shortcuts
Bulk edit selected rows
Keyboard row navigation
Property editing without mouse
9. Advanced UX Patterns

These are subtle but important.

Peek modes
Side peek
Center modal
Full page
Progressive disclosure
Minimal cells initially
Expand details on demand
Contextual toolbars
Hover actions
Floating property menus
Inline AI actions
Smart empty states
“Add property”
“Create first record”
Suggested templates
Drag affordances
Ghost previews
Drop targets
Animated reordering



ENsure no bleeding of one cell content into another. 

Drop the drop down on left to view dropdown since the lists appear above it. 

Fix errors, populate help and settings.

Settings defines:

“How much autonomy does Bridge have, and under what boundaries?”

It governs:

AI behavior
Relationship privacy
Execution permissions
Data ingestion
Notification sensitivity
Identity boundaries

Think of it as:

The constitutional layer of the system.

1. Identity & Profile Settings

Controls user and workspace identity.

User Profile
Name
Role / archetype (Founder, Investor, Operator, Connector)
Timezone
Location (optional)
Communication preferences
Relationship Persona (IMPORTANT)

Defines how Bridge behaves socially.

Examples:

“Private Builder”
“High Connector”
“Investor Mode”
“Operator Mode”
“Minimal Exposure Mode”

This affects:

Signal sensitivity
Suggestion aggressiveness
Intro recommendations
2. Network Privacy Settings

Controls what Bridge can see and use.

Data Visibility
Full network access (ON/OFF)
Partial ingestion sources
Manual-only mode (no automation ingestion)
Source Controls

Toggle per integration:

Gmail
Calendar
Slack
WhatsApp (future)
Notes / Files

Each source has:

Read access
Write access
Sync frequency
Relationship Sensitivity

Defines how “bold” Bridge can be.

Conservative (low suggestion frequency)
Balanced
Proactive (high signal surfacing)
3. Signal Behavior Settings

Controls Network → Signals layer.

Signal Types Toggle
Dormant relationships
Introductions
Hiring signals
Fundraising signals
Event proximity signals
Community movements
Signal Frequency
Real-time
Daily digest
Weekly digest
Signal Depth
Surface only (what + who)
Contextual (what + who + why)
Deep reasoning (full trace + prediction)
4. Agent Autonomy Settings

This is critical.

Defines how independent AI is allowed to be.

Execution Modes
Manual Mode
AI suggests only
No execution allowed
Assisted Mode
AI drafts everything
User approves execution
Autonomous Mode (bounded)
AI can execute within policy limits
Sensitive actions still require approval
Action Boundaries
Can AI send messages? (Yes/No)
Can AI create introductions? (Yes/No/Approval)
Can AI schedule meetings? (Yes/No)
Can AI modify initiatives? (Yes/No)
5. Policy Defaults

These define system-wide governance behavior.

Introduction Policy
Always require approval
Auto-approve within same community
Fully autonomous (rare)
Communication Policy
AI can draft messages
AI can send messages (rare / restricted)
Always require preview before send
Memory/Timeline Policy (important)

Even though there are no “memory objects”, timeline entries still exist:

Auto-log interactions (ON/OFF)
Require confirmation before logging sensitive interactions
6. Notification & Attention Settings

Bridge is an attention-sensitive system.

Signal Delivery Mode
Real-time interruptions
Digest mode
Silent (dashboard-only)
Priority Rules

Define what breaks attention:

High priority signals only
All signals
Only initiative-linked signals
Quiet Hours
Time windows
Travel mode
Deep work mode
7. Initiative-Level Defaults

These settings cascade into Initiatives.

Default Behavior Per Initiative
AI participation level
Auto-suggested touchpoints ON/OFF
Ritual activation ON/OFF
Knowledgebase auto-organization
Example
Initiatives:
  AI\_Assist: true
  Auto\_Touchpoints: false
  Auto\_Summarization: true
8. Integration Controls

Controls external systems.

Connect / disconnect integrations
Permission scopes per integration
Sync direction (read-only / bidirectional)
Data filtering rules
9. Audit & Transparency Settings

Controls visibility into system behavior.

Decision Trace Visibility
ON (recommended default)
OFF (rare)
Ledger Access
User only
Shared with team (future)
Export enabled
Explainability Level
Minimal
Standard
Full reasoning trace
10. Experimental / Advanced Settings

Where future AI capabilities are gated.

Multi-agent collaboration ON/OFF
Predictive relationship modeling ON/OFF
Autonomous initiative suggestions ON/OFF
Cross-community inference ON/OFF