// Tools registry — single source of truth for the Tools page, the /tool/:id detail page, and the
// Sidebar pinned-tools nav. Previously this vocabulary was split (ToolsPage had heat-map/opportunity/…
// while the Sidebar's toolMeta + ItemDetail listed reconnect/open-threads/…), so pinned tools never
// rendered. This unifies on the on-brand relationship tools, each tied to the Signals engine.
import type { ComponentType } from 'react';
import { RefreshCw, MessageCircle, Activity, Search, Milestone, Briefcase, Users, CalendarClock, Cable, ShieldCheck, ScanLine, Mic, LifeBuoy, BookOpen, Camera, Compass, Handshake } from 'lucide-react';

export type ToolList = 'My Tools' | 'Templates' | 'Systems';

export interface Tool {
  id: string;
  name: string;
  description: string;
  category: string;
  status: 'Live' | 'Template' | 'Available';
  list: ToolList;
  icon: ComponentType<any>;
  color: string;
  overview: string;
  capabilities: string[];
  watches?: string[];     // the signals / sources this tool draws on
  lastUsed: string;       // qualitative, never a naked number
  route?: string;         // custom destination (else /tool/:id) — e.g. Approvals → /approvals
  badge?: 'approvals';    // dynamic badge source rendered by the nav (pending count)
  intake?: boolean;       // internalized capture-tool: shows a pending-captures panel (quarantine → Add)
  source_repo?: string;   // provenance of the internalized copy
  appUrl?: string;        // runnable tool app — embedded (iframe) in the detail page, faithful to its own UI
  native?: boolean;       // tool UI is ported into Bridge and renders in-app (no separate server)
}

export const tools: Tool[] = [
  {
    id: 'approvals',
    name: 'Approvals',
    description: 'The review inbox — every agent draft lands here for approve / veto / edit before it commits.',
    category: 'Governance', status: 'Live', list: 'Systems', icon: ShieldCheck, color: '#4D7EA8',
    overview: 'The draft-then-approve chokepoint. Agents propose; nothing commits without your decision. Pinned by default so the pending count stays in view — this is the trust moat made visible.',
    capabilities: ['Review agent proposals', 'Approve, veto, or edit', 'See the decision trace (pre/runtime/post)', 'Append-only audit ledger'],
    watches: ['Pending ledger rows', 'Signal-proposed actions'],
    lastUsed: 'Live',
    route: '/approvals',
    badge: 'approvals',
  },
  {
    id: 'card-scanner',
    name: 'Card Scanner',
    description: 'Scan a business card → a Person + a “Met” Touchpoint. Runs standalone or via a shared link; captures land here for review.',
    category: 'Capture', status: 'Live', list: 'My Tools', icon: ScanLine, color: '#6B7C65',
    overview: 'An internalized Tool. Vision-LLM reads a business card (local model by default) and proposes a Person plus a “Met / scanned card” Touchpoint. Two run modes: standalone (download the data) or a shareable link a friend can use without an account. Captures are quarantined and only enter the graph when you Add them — routed through the governed pipeline, never a silent write.',
    capabilities: ['Vision extraction (local model default)', 'Standalone + shareable-link run modes', 'Quarantined intake — capture ≠ commit', 'Per-capture Add → governed Person + Touchpoint'],
    watches: ['tool_captures (quarantine)', 'Card vision output contract'],
    lastUsed: 'Live',
    intake: true,
    source_repo: 'Tools/card-scanner (internalized copy)',
    native: true,   // ported into Bridge — runs in-app on the Bridge origin (no separate server)
  },
  {
    id: 'camera',
    name: 'Camera',
    description: 'Capture a photo or video → it stays private on your device until you Add it as a governed Touchpoint. Local-only blobs, OCR on photos.',
    category: 'Capture', status: 'Live', list: 'My Tools', icon: Camera, color: '#6B7C65',
    overview: 'A built-in capture Tool. Take a photo (getUserMedia) or record a video (MediaRecorder); images are compressed and OCR-read locally. Every blob is private relationship data — it lives in a LOCAL store on this device and NEVER crosses the gate to the cloud. Captures are quarantined; Add to Bridge raises a governed Touchpoint proposal (optional link to a Person/Memory/Touchpoint) — review → approve → append-only ledger. Uncertain person matches are never auto-linked; they file a possible_link Signal.',
    capabilities: ['Photo + video capture (local getUserMedia/MediaRecorder)', 'Client-side compression + local OCR (no API key)', 'Blobs stored LOCAL-only — never the cloud', 'Quarantined intake — Add → governed Touchpoint proposal'],
    watches: ['Local media store (this device)', 'media.v1 output contract'],
    lastUsed: 'Live',
    intake: true,
    source_repo: 'Tools/card-scanner + Tools/recorder (capture patterns)',
    native: true,
  },
  {
    id: 'recorder',
    name: 'Recorder',
    description: 'Record or paste a conversation → a Memory + next-step Touchpoints under an Initiative. Single-party, private, local transcription.',
    category: 'Capture', status: 'Live', list: 'My Tools', icon: Mic, color: '#2E4057',
    overview: 'An internalized Tool. Capture a conversation (mic, upload, or paste), transcribe locally (Whisper), and an LLM drafts a summary + next steps. Single-party self-capture — the transcript is your private relationship-tier data and stays local. Captures are quarantined; Add routes a Memory + Touchpoints proposal through the governed pipeline into an Initiative — never a silent write.',
    capabilities: ['Local transcription (Whisper) + summary', 'Single-party self-capture · private scope', 'next_steps → Touchpoints (owner/due)', 'Per-capture Add → Memory + Initiative proposal'],
    watches: ['tool_captures (quarantine)', 'conversation.v1 output contract'],
    lastUsed: 'Live',
    intake: true,
    source_repo: 'Tools/recorder (internalized copy)',
    appUrl: 'http://localhost:5174',   // Vite dev (cd Tools/recorder/frontend && npm run dev -- --port 5174)
  },
  {
    id: 'helpdesk',
    name: 'Helpdesk',
    description: 'AI-mediated assistance — route a need to people who can help (by capability, not topic) and propose concrete ways they could contribute.',
    category: 'Assistance', status: 'Live', list: 'Systems', icon: LifeBuoy, color: '#4D7EA8',
    overview: 'Ask for help and Bridge routes it only to people who can meaningfully contribute — scored on capability, not topic — and proposes actionable ways each could help. Invisible to everyone else: no feed, no notification fatigue. Recipients decide; every offer is drafted for review, never auto-sent.',
    capabilities: ['Capability-based routing (not topic)', 'Invisible-by-default — no feed noise', 'AI-assisted + Broadcast modes', 'Offer Help → governed draft → Touchpoint'],
    watches: ['Relationship graph', 'Help Requests', 'Capability overlap'],
    lastUsed: 'Live',
    route: '/module/relationship/helpdesk',
  },
  {
    id: 'jobpilot',
    name: 'JobPilot',
    description: 'Swipe green, get applied — sources job postings, scores fit, tailors materials under a fabrication guard, and applies through a governed tier waterfall.',
    category: 'Work', status: 'Live', list: 'My Tools', icon: Compass, color: '#4D7EA8',
    overview: 'A local-first application copilot: cards score fit against your profile (green/yellow/red), a deterministic evaluator blocks fabricated resume claims before anything tailors, and a tiered apply dispatcher (direct ATS POST → form-fill → browser agent → human handoff) never submits without an approved eval. Standardized card/kanban/list views — same engine as Helpdesk and the network tables.',
    capabilities: ['Card feed with fit scoring', 'Fabrication-guard evaluator', 'Tiered apply dispatcher + pacing caps', 'Kanban tracker + list view'],
    watches: ['Job postings (Tier-1 ATS connectors)', 'Application pipeline stage_events'],
    lastUsed: 'Live',
    route: '/jobpilot',
    native: true,
    source_repo: 'platform/tools/jobpilot',
  },
  {
    id: 'dealpilot',
    name: 'DealPilot',
    description: 'Sources small-business listings, scores thesis fit, and tracks the pipeline from sourced to closed.',
    category: 'Work', status: 'Live', list: 'My Tools', icon: Handshake, color: '#6B7C65',
    overview: 'A deal-sourcing copilot: listings score against your thesis profile (industry/geo/SDE), triaged green/yellow/red, and tracked through a sourced → reviewing → diligence → offer → closed pipeline. Standardized card/kanban/list views — same engine as JobPilot and the network tables.',
    capabilities: ['Card feed with thesis-fit scoring', 'Deal dedupe (company identity match)', 'Pipeline kanban + list view', 'Living deal profile (append-only facts)'],
    watches: ['BizBuySell / BusinessBroker listings', 'Deal pipeline stage'],
    lastUsed: 'Live',
    route: '/dealpilot',
    native: true,
    source_repo: 'platform/tools/dealpilot',
  },
  {
    id: 'calendar',
    name: 'Task Manager',
    description: 'Rank and schedule pending work across your planning window; Google Calendar remains available as a connected source.',
    category: 'Coordination', status: 'Live', list: 'My Tools', icon: CalendarClock, color: '#4D7EA8',
    overview: 'A native planning table over the pending roadmap, bug, request, and approval queue. Each work item receives a day in the current 12-day planning window and can be re-ranked, edited, hidden, or rescheduled. Google Calendar remains a connected source and is available at the Google calendar detail route.',
    capabilities: ['12-day work planning window', 'Rank and reschedule tasks', 'Notion-style column and row controls', 'Source-linked pending work'],
    watches: ['Google Calendar (external_records)', 'CalendarEvent contract'],
    lastUsed: 'Live',
    route: '/calendar',
    native: true,
    source_repo: 'in-house (date-fns render) · @bridge/integrations-google (sync)',
  },
  {
    id: 'reconnect',
    name: 'Reconnect',
    description: 'Surface high-trust ties whose warmth is cooling and draft a reconnect note.',
    category: 'Relationships', status: 'Live', list: 'My Tools', icon: RefreshCw, color: '#4D7EA8',
    overview: 'Watches for relationships where trust is high but warmth has slipped, then drafts a light-touch note so a valuable tie does not go dormant. Acting drafts into Approvals — it never sends on its own.',
    capabilities: ['Rank ties by the trust↔warmth gap', 'Draft a personal reconnect note', 'Hold 20 minutes on the calendar', 'Add a person to a check-in workflow'],
    watches: ['Dormant signal', 'Warmth & trust bands', 'Last touchpoint'],
    lastUsed: 'Today',
  },
  {
    id: 'open-threads',
    name: 'Open Threads',
    description: 'Inbound messages from your network with no recorded reply — draft a close.',
    category: 'Communication', status: 'Live', list: 'My Tools', icon: MessageCircle, color: '#1A2B3C',
    overview: 'Finds inbound touchpoints that were never answered and drafts a reply, so low-effort, high-reciprocity threads stop slipping through the cracks.',
    capabilities: ['Detect inbound with no reply', 'Draft a reply in your voice', 'Snooze a thread', 'Route to the right workflow'],
    watches: ['Help signal', 'Gmail threads', 'Direction = inbound'],
    lastUsed: 'Yesterday',
  },
  {
    id: 'community-pulse',
    name: 'Community Pulse',
    description: 'Track movement in your densest communities; spot a gathering worth convening.',
    category: 'Communities', status: 'Live', list: 'My Tools', icon: Activity, color: '#C4955A',
    overview: 'A dense community is leverage — one well-placed touch reaches many ties at once. Community Pulse ranks where you have the most reach and proposes a gathering or shared resource.',
    capabilities: ['Rank communities by known members', 'Propose a small gathering', 'Shortlist attendees', 'Draft an invite'],
    watches: ['Community signal', 'Shared communities', 'Member density'],
    lastUsed: 'This week',
  },
  {
    id: 'memory-search',
    name: 'Memory Search',
    description: 'Ask anything across your relationships and touchpoints; get grounded answers.',
    category: 'Search', status: 'Live', list: 'My Tools', icon: Search, color: '#6B7C65',
    overview: 'Natural-language search across people, communities, and memories. Answers cite the touchpoints they stand on, so you can trust what comes back.',
    capabilities: ['Semantic search across the network', 'Cite source touchpoints', 'Filter by community or time', 'Summarise a relationship history'],
    watches: ['People', 'Memories', 'Touchpoints'],
    lastUsed: 'Today',
  },
  {
    id: 'milestones',
    name: 'Milestones',
    description: 'Watch for role changes, fundraises, and launches across your network.',
    category: 'Signals', status: 'Live', list: 'My Tools', icon: Milestone, color: '#2E4057',
    overview: 'Surfaces well-timed reasons to reach out — a raise, a launch, a new role — so a congratulations lands when it matters.',
    capabilities: ['Detect public milestones', 'Draft a timely note', 'Add to an opportunity tracker', 'Suggest a specific offer of help'],
    watches: ['Hiring/Fundraising signal', 'Role & company changes'],
    lastUsed: 'This week',
  },
  {
    id: 'career-moves',
    name: 'Career Moves',
    description: 'Detect when someone changes roles and prompt a timely, specific note.',
    category: 'Signals', status: 'Live', list: 'My Tools', icon: Briefcase, color: '#7FA5C5',
    overview: 'A role change is one of the highest-signal moments in a relationship. Career Moves catches the change and drafts a note that references it specifically.',
    capabilities: ['Track position changes', 'Draft a congratulations', 'Refresh the person’s context', 'Flag a warm-intro opportunity'],
    watches: ['Position field', 'Community moves'],
    lastUsed: 'Last week',
  },
  {
    id: 'tpl-intro-round',
    name: 'Intro Round',
    description: 'Batch double-sided introductions you have already vetted.',
    category: 'Introductions', status: 'Template', list: 'Templates', icon: Users, color: '#4D7EA8',
    overview: 'A reusable template that collects intros you want to make, drafts each as a direct double-sided note, and queues them for one review pass.',
    capabilities: ['Collect pending intros', 'Draft each double-sided', 'Review as one batch', 'Record outcomes to the ledger'],
    watches: ['Introduction signal'],
    lastUsed: '—',
  },
  {
    id: 'tpl-checkin',
    name: 'Monthly Check-in',
    description: 'A recurring cadence that keeps your inner ring warm.',
    category: 'Cadence', status: 'Template', list: 'Templates', icon: CalendarClock, color: '#6B7C65',
    overview: 'A workflow template that rotates through your inner-ring ties on a monthly cadence and drafts a light touch for each.',
    capabilities: ['Rotate inner-ring ties', 'Draft a monthly touch', 'Skip recently-contacted', 'Respect quiet hours'],
    watches: ['Ring = Inner / Close', 'Last touchpoint'],
    lastUsed: '—',
  },
  {
    id: 'resources',
    name: 'Resources',
    description: 'A living library of books, podcasts, and vlogs for acquisition entrepreneurs — every entry links to the source, on the device or online.',
    category: 'Knowledge', status: 'Live', list: 'My Tools', icon: BookOpen, color: '#4D7EA8',
    overview: 'A curated, filterable table of learning resources — reading, podcasts, and vlogs — on search funds and ETA. Each row links out to its source (Amazon, YouTube, the author’s site). Seeded from the Searchfunder reading and podcast galleries; backed by the resources_canonical store. Pin it to the sidebar for one-click access.',
    capabilities: ['Books, podcasts & vlogs in one table', 'Filter by type or topic', 'Open any resource at its source', 'Pin to the sidebar for quick access'],
    watches: ['resources_canonical store'],
    lastUsed: 'Live',
    route: '/resources',
  },
  {
    id: 'sys-api',
    name: 'API Connector',
    description: 'REST / GraphQL bridge for workflows and external systems.',
    category: 'Integration', status: 'Available', list: 'Systems', icon: Cable, color: '#2E4057',
    overview: 'Lets a workflow call an external system as a step, and lets external systems trigger a workflow — always through the governed action pipeline.',
    capabilities: ['Call REST / GraphQL from a workflow', 'Map fields to the canonical model', 'Sign & log every call to the ledger', 'Inbound webhook triggers'],
    watches: ['Workflow steps', 'Governance ledger'],
    lastUsed: '—',
  },
];

export const toolById = (id: string): Tool | undefined => tools.find(t => t.id === id);
export const toolLists: ToolList[] = ['My Tools', 'Templates', 'Systems'];
