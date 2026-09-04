# Optimized implementation prompt: Zazoo alternative homepage

You are the Creative Director and design engineer for Zazoo. Build an experimental alternative homepage and a separate, verified case-study library.

This is an isolated experiment. Do not replace, edit, commit to, or merge into the existing homepage or `main` branch.

## 1. Outcome

Create a cinematic, interactive homepage that changes how an executive thinks about organizational transformation in the AI era.

The page must lead the visitor through one connected discovery:

1. Paradigm shifts reward organizations that redesign themselves, not organizations that merely adopt new tools.
2. AI-native organizations are structurally different because intelligence flows and compounds across them.
3. That transformation requires an invisible organizational environment in which people and AI can work together naturally.
4. Leaders must intentionally manage the progression from individual AI productivity to a transformed competitive model.

Zazoo is the conclusion of this journey, never its opening premise.

Exactly four narrative sections are defined below. Produce four Section Design Decisions. Do not invent three additional sections.

## 2. Non-negotiable repository isolation

Before editing code:

1. Inspect the repository's canonical instructions and current task state.
2. Locate the existing Zazoo website and identify its package manager, framework, build commands, design tokens, routing convention, shared components, and test setup.
3. Fetch the current remote default branch without discarding or overwriting user work.
4. Create a new branch from the current `origin/main` named `codex/zazoo-alt-home-creative-direction` or another `codex/`-prefixed equivalent.
5. Keep `/` and the existing homepage component unchanged.
6. Add the experiment at `/alternative-home` or the repository's equivalent isolated route/entry.
7. Do not add a link to the experiment from the existing homepage.
8. Do not commit directly to `main`, merge into `main`, or modify remote `main`.

Allowed shared changes are limited to the smallest route/build registration required to make the new page reachable. Do not redesign shared components or global tokens for this experiment.

If the existing homepage file changes in the final diff, restore it before finishing.

## 3. Required deliverables

All deliverables must exist on the experiment branch:

1. A working alternative homepage at the isolated route.
2. `design-decisions.md`, containing one concise Section Design Decision for each of the four sections.
3. `case-study-library.md`, containing 15-25 real, verified case studies.
4. A short `README` or handoff section containing:
   - route and run instructions;
   - changed files;
   - test commands and results;
   - desktop and mobile screenshots;
   - known limitations;
   - confirmation that `/` and the original homepage remain unchanged.

Do not expose private chain-of-thought. `design-decisions.md` should contain concise, reviewable design rationale only.

## 4. Mandatory design sequence for every section

Complete these steps before implementing each section:

### Step 0 - Emotional transformation

Define:

- entering emotion;
- exiting emotion;
- the change in understanding between them.

### Step 1 - One job

State the single result the section must achieve.

### Step 2 - One misconception

Name one belief the section challenges. Do not combine multiple misconceptions.

### Step 3 - Discovery path

Define how the visitor reaches the conclusion through observation, comparison, progressive reveal, or interaction. Do not reveal the conclusion at the start.

### Step 4 - Strongest medium

Choose the medium that communicates the idea better than prose: animation, morphing illustration, simulation, comparative scene, transformation journey, or another visual mechanism.

### Step 5 - Copy last

Add only the exact approved copy listed in this brief. If a meaning is already clear visually, do not restate it.

For each section, record one paragraph in `design-decisions.md` using this structure:

> Entering emotion -> exiting emotion. Misconception challenged. Discovery mechanism. Chosen medium and why it communicates the idea better than explanatory text.

If the implementation drifts from its recorded decision, fix the implementation.

## 5. Global experience rules

### Narrative

- The homepage must feel like one documentary with four connected chapters, not four stacked landing-page sections.
- Each section must end by creating the question answered by the next section.
- Use motivated camera movement, shared visual motifs, lighting changes, and object continuity between sections.
- Never use a hard white gap as a transition.
- Never open a section with a heading followed by explanatory paragraphs.
- The primary insight of each section must remain understandable when visible text is blurred.

### Visual language

- Inherit the existing Zazoo site's approved brand tokens and typography.
- Direction: editorial, cinematic, warm, intelligent, human, premium, and quietly optimistic.
- Prefer tactile illustration, restrained depth, purposeful motion, and visual metaphor.
- Avoid generic SaaS cards, feature grids, dashboards, architecture diagrams, glowing AI gradients, cyber imagery, stock robots, stock photography, and decorative animation.
- Do not imitate the trade dress of Gartner, Kirkpatrick, or another proprietary framework.

### Copy boundary

- Only text listed under a section's **Copy - exact visible text** may appear in that section.
- Controlled exception: Section 1 may use short factual evidence fragments created from verified cases in `case-study-library.md`. Every such fragment must be quoted verbatim in the library beside its source and marked `Used on page`.
- Creative direction, emotional goals, scene descriptions, labels such as `misconception`, and implementation notes must never appear as visible copy.
- Render exact copy deterministically in accessible HTML. Do not bake text into generated images or video.
- Do not invent claims, metrics, testimonials, customer names, prices, certifications, or CTAs.

### Animation

- Every animation must teach part of the argument.
- State each animation's duration, trigger, playback behavior, loop behavior, and resting frame in code comments or the design decision document.
- No autoplay audio.
- Pause off-screen animation.
- Do not trap the visitor's scroll.
- Use smooth, reversible scroll-linked transitions where specified.

### Interaction and accessibility

- Every hover behavior must also work with keyboard focus and tap.
- Interactive elements must be actual buttons or links with accessible names.
- Provide visible focus states.
- Honor `prefers-reduced-motion` with meaningful still frames or short crossfades. Do not simply remove the story.
- Meet WCAG 2.2 AA contrast and logical heading order.
- Do not use color as the only state indicator.

### Responsive behavior

- Design desktop and mobile compositions separately.
- Required validation widths: the repository's normal desktop viewport and 375 px mobile.
- Do not scale a complex desktop canvas down until labels or scenes become unreadable.
- Avoid horizontal page overflow.
- Touch targets must be at least 44 x 44 px.

### Performance

- Lazy-load assets below the first scene.
- Use optimized vector, canvas, CSS, or lightweight video formats appropriate to the repository.
- Provide a poster/resting frame for any rendered video.
- Keep the first meaningful frame fast and stable; avoid layout shift.
- Maintain smooth motion on a mid-range mobile device.

## 6. Section 1 - Patterns across paradigm shifts

### Goal

Lead the visitor to discover that every major paradigm shift creates two kinds of organizations: those that apply new technology to yesterday's model, and those that redesign themselves for tomorrow.

### Entering emotion

Recognition: `I remember these organizations and eras.`

### Exiting emotion

Reflective urgency: `The relevant question is not how we adopt AI, but how we redesign for it.`

### Misconception

AI is another technology adoption cycle.

### Discovery mechanism

The visitor compares transitional and transformational responses across several eras. Repetition reveals the pattern. The section never announces the lesson before the visitor has seen enough evidence to infer it.

### Medium

A pinned, full-viewport comparative stage driven by page scroll. The visible canvas remains one viewport; an outer scroll range advances evidence within it. This resolves the need for multiple examples without stacking cards or trapping nested scroll.

### Layout

- A five-choice era selector across the top:
  - Steam Engine
  - Electricity
  - Computing
  - Internet
  - Artificial Intelligence
- One era is active at a time.
- Changing era crossfades or morphs the scene; never slide it horizontally.
- The main stage is a balanced two-column comparison:
  - left: Transitional Thinking;
  - right: Transformational Thinking.
- Each side contains:
  - one half of a paired observation;
  - one dominant illustration;
  - no more than four short evidence fragments.
- A bottom observation connects the two sides.

### Animation - mandatory

- Section scroll range: approximately 500-700 vh on desktop, shortened on mobile.
- Each scroll step changes the example while preserving the stage layout.
- Transition between examples: 600-900 ms morph/crossfade.
- Each example first reveals the transitional response, then the transformed response, then the paired observation.
- Suggested Internet evidence sequence:
  1. Commerce: Barnes & Noble -> Amazon.
  2. Entertainment: Blockbuster -> Netflix.
  3. Photography: Kodak -> Instagram.
- Do not automatically add additional named companies. Every displayed company claim must be verified in the case-study library.
- Steam Engine, Electricity, and Computing evidence must be selected from the verified library. Do not invent illustrative companies or unsupported causal claims to fill those eras.
- The AI era follows the same left-side structure but intentionally withholds the right-side answer:
  - left: meetings, email, existing workflows, hierarchy, and departments gain assistants while remaining structurally unchanged;
  - right: an unfinished organization appears as blueprints, construction lines, partial pathways, and unresolved forms;
  - no definitive AI-native company is shown.
- Resting frame: the unfinished AI-native organization with one open pathway into Section 2.

### Interaction

- Era selector works by click, tap, and keyboard.
- Page scroll advances examples within the active era.
- `More examples` extends the selected era's evidence sequence in place. It does not open a page, modal, card grid, or nested scroll container.
- Preserve the selected era when the visitor scrolls backward.

### Copy - exact visible text

Hero heading:

> History doesn't repeat. Patterns do.

Hero body:

> Every major paradigm shift transforms the market.  
> The organizations that merely adopt the new technology have faded with the past.  
> The organizations that transform themselves around it defined the future.

Reflection question:

> When history looks back at the AI era, where will your organization stand?

Actions:

> Book a strategy session

> Assess your organization

Column labels:

> Transitional Thinking

> Transformational Thinking

Internet paired observation:

> The market didn't reward organizations that adopted the Internet.

> It rewarded organizations designed around it.

Bottom observation:

> Technology changes what's possible. Transformation changes who leads.

AI closing observation:

> Every previous paradigm created a new generation of market leaders. AI will too.

Expansion action:

> More examples

The `Book a strategy session` link must point exactly to:

`https://zazoo.me/consulting.html#cta`

Do not invent a destination for `Assess your organization`. If no approved destination exists, render it as visibly unavailable or omit it and record the limitation.

### Do not build

- a history timeline;
- a company-comparison grid;
- independent cards;
- a consulting framework;
- long company biographies;
- a definitive answer for the AI-native winner.

### Transition

The unfinished AI organization's construction lines begin moving. Departments, knowledge, and decisions become the living organization in Section 2. The visitor should enter Section 2 asking: `What actually changes inside an AI-native organization?`

### Acceptance test

With body copy hidden, a reviewer can still identify the repeated transitional-versus-transformational pattern and understand why the AI-side answer remains unfinished.

## 7. Section 2 - The AI-native organization

### Goal

Show that organizations themselves change when intelligence becomes a shared, compounding capability.

### Entering emotion

Curiosity: `What would actually be different?`

### Exiting emotion

Possibility: `This changes the organization, not only its tools.`

### Misconception

Adopting AI means adding tools to existing workflows.

### Discovery mechanism

Start with a familiar organization. Transform one relationship at a time and let the visitor observe the consequences: knowledge moves, decisions shorten, capability persists, and successful practices become reusable.

### Medium

A living, explorable organizational illustration that morphs between `before` and `after`. Do not use an org chart, architecture diagram, capability framework, pyramid, or boxes-and-arrows diagram.

### Layout

- One large organization fills the viewport.
- The initial state is recognizable but fragmented:
  - knowledge stays with individuals;
  - departments form boundaries;
  - decisions travel up and back down;
  - managers chase status;
  - repeated work starts from zero.
- The transformed state uses the same people and organization. Do not imply replacement or headcount removal.

### Animation - mandatory

Length: 18-24 seconds of scroll-linked transformation.

Sequence:

1. A successful decision occurs in one team but remains isolated.
2. The visitor activates `Knowledge flows`; the decision becomes reusable context elsewhere.
3. The visitor activates `Decisions shorten`; relevant people and context converge without hierarchy ping-pong.
4. The visitor activates `Capability compounds`; a successful practice becomes available across the organization.
5. The visitor activates `Memory persists`; the organization retains learning when an individual leaves the immediate scene.
6. The organization settles into a coordinated living state, with people still exercising judgment.

Resting frame: intelligence moving through the organization as a calm shared current, not a glowing network.

### Interaction

- A four-state scrubber or four direct controls lets visitors compare the same organization before and after each change.
- Each control answers `What changes because of AI?`
- Do not label product features or technical capabilities.
- Provide a single `Compare before` control that restores the initial state without losing focus position.

### Copy - exact visible text

Heading:

> AI-native organizations don't use AI. They are designed around it.

Subheading:

> The difference isn't how much AI they deploy. It's how intelligence flows, compounds, and creates value across the organization.

Progressive lines, revealed only after the corresponding visual change:

> Knowledge no longer belongs to individuals.

> Capability no longer depends on departments.

> Every success makes the organization stronger.

Closing line:

> AI no longer supports work. It becomes part of how the organization thinks, learns, and creates value.

Controls:

> Knowledge flows

> Decisions shorten

> Capability compounds

> Memory persists

> Compare before

### Transition

Follow one ordinary task moving through the transformed organization. The camera closes in until the single task fills the frame and becomes Section 3. The visitor should ask: `What makes that flow possible every day?`

### Acceptance test

A reviewer can describe at least three structural changes without seeing a feature name or explanatory diagram.

## 8. Section 3 - Business AI Infrastructure

### Goal

Help the visitor discover that the largest obstacle is often not AI capability, but the environment in which work happens.

### Entering emotion

Familiar confidence: `This task should be simple.`

### Exiting emotion

Relief and recognition: `The work was not the hard part; the environment created the friction.`

### Misconception

AI transformation mainly requires better software, models, integrations, or automation.

### Discovery mechanism

Show the same ordinary work twice. The objective and employee remain identical. Only the surrounding organizational environment changes.

### Medium

A large animated story using one universally familiar task: `Prepare a board presentation.` Do not offer multiple task choices in v1.

### Layout

- One employee and one task remain centered throughout the sequence.
- Questions and interruptions emerge from the actual work environment.
- The improved environment appears through people, knowledge, ownership, decisions, approvals, memory, and context.
- Never show servers, APIs, code, databases, network maps, clouds, or a technology stack.

### Animation - mandatory

Length: 24-30 seconds, controlled by page scroll.

Scene 1 - Simple task:

- The employee receives `Prepare the board presentation`.
- A clean presentation outline appears.

Scene 2 - Friction accumulates:

- Questions appear one at a time around the work, never as toast notifications.
- Use no more than six:
  - Where is the latest version?
  - Who owns this?
  - Who approves this?
  - Has someone solved this before?
  - Is this still current?
  - Who needs to review this?
- Each question creates a small detour, wait, duplicate, or interruption.
- The employee remains calm; the scene communicates death by a thousand tiny hurdles without slapstick frustration.

Scene 3 - Environment changes:

- Relevant knowledge moves into reach.
- Ownership becomes visible.
- Previous decisions and work surface.
- Approval and review paths become clear.
- Relevant people become visible.
- AI companions participate quietly within allowed boundaries.
- Nothing is presented as magic or instantaneous omniscience.

Scene 4 - Replay:

- Restart the exact same task with the exact same employee and objective.
- Remove searching, repeated questions, duplicate work, unnecessary meetings, and waiting for context.
- The employee is not faster because they work harder; the environment carries less friction.

Scene 5 - Zoom out:

- Pull back from one employee to hundreds of people supported by the same invisible environment.
- The organization reads as one coordinated living system, not disconnected departments.

Resting frame: many calm work paths supported by a shared environment.

### Interaction

- Each of the six friction questions is a button.
- Activating it reveals the cause and response visually by tracing the detour in the first replay and the frictionless route in the second replay.
- No explanatory microcopy has been approved for these reveals. Do not invent it. Record the missing optional microcopy in the handoff if the visual response is not sufficient.
- No technical solution names.
- The sequence remains understandable without activating any question.

### Copy - exact visible text

Task:

> Prepare the board presentation.

Friction questions:

> Where is the latest version?

> Who owns this?

> Who approves this?

> Has someone solved this before?

> Is this still current?

> Who needs to review this?

Definition heading, displayed only after the replay:

> Business AI Infrastructure

Definition:

> Business AI Infrastructure is the invisible environment that allows people and AI to work together effortlessly.

Supporting definition:

> It is made up of the knowledge, context, ownership, governance, workflows, decision pathways, organizational memory, and operating practices that remove friction from everyday work.

Closing contrast:

> Technology enables it. People experience it.

Closing statement:

> Great organizations don't ask people to overcome friction. They design environments where great work happens naturally.

### Transition

During the zoom-out, the coordinated work paths form five successive operating states. The camera reframes them as Section 4's transformation journey. The visitor should ask: `How does an organization intentionally progress from here?`

### Acceptance test

Before the definition appears, a reviewer can explain why the same task became easier and can identify the environment - not the employee or AI model - as the changed variable.

## 9. Section 4 - Managing intelligence

### Goal

Help an executive recognize their organization's current transformation state and understand what must fundamentally change to reach the next state.

### Entering emotion

Orientation: `Where are we?`

### Exiting emotion

Constructive urgency: `The next state requires intentional organizational redesign.`

### Misconception

Organizations progress mainly by deploying more AI.

### Discovery mechanism

Visitors explore five qualitatively different organizational states. Each state changes where value comes from and how leadership contributes. The sequence is not a score, grade, checklist, ranking, or generic AI maturity model.

### Medium

An interactive transformation journey with five connected environments. Only one state is expanded at a time. Do not label it a maturity model and do not imitate a proprietary consulting framework.

### Layout

- Five connected stages follow one continuous path.
- The path does not imply that every organization must reach Level 5.
- One stage is active at a time.
- Each active stage is examined through exactly four question lenses:
  1. What changes?
  2. Where does organizational value come from?
  3. How does leadership evolve?
  4. What becomes possible next?
- Selecting a lens changes the illustration's emphasis. The approved stage description is the only prose answer. Do not invent four additional paragraphs.

### Animation - mandatory

- Transition between stages: 700-1,000 ms.
- The same organization changes across all five stages; do not swap to unrelated illustrations.
- Progressively change the organization, not the amount of glowing AI:
  1. individual tools accelerate existing work;
  2. teams redesign selected workflows;
  3. knowledge and successful practices become shared and reusable;
  4. governance, decisions, roles, incentives, and operating models change together;
  5. the organization creates value in a way enabled by its transformed design.
- Leadership remains visible throughout and becomes more consequential as coordination, judgment, stewardship, and organizational design matter more.
- Resting frame: the selected stage connected visibly to the next possible state.

### Interaction

- Click, tap, keyboard focus, or arrow keys select a stage.
- Hover may preview but must not be required.
- Expanding a stage reveals its approved description. Selecting the four question lenses changes the visual emphasis in sequence.
- The final answer visually connects to the next stage.
- No scores, progress percentages, readiness badges, red/amber/green states, or automatic recommendation.

### Copy - exact visible text

Section heading:

> Managing Intelligence

Introductory line:

> Transformation changes where organizational value comes from - and what leadership must make possible.

Stage 1:

> Doing the Same Work Differently

> AI improves individual productivity. Existing work becomes faster, but the organization remains unchanged. Capability stays personal - when people leave, the capability leaves with them.

Stage 2:

> Doing Different Work the Same Way

> Teams redesign workflows and begin delegating work to AI. Processes improve and efficiency increases, but the company still creates value the same way.

Stage 3:

> Working Differently

> Knowledge, decisions, and intelligence begin compounding across the organization. AI becomes a shared organizational capability. Memory, skills, and successful practices become reusable. Intelligence improves continuously.

Stage 4:

> Organizing Differently

> The organization redesigns itself around intelligence. Governance, decision systems, operating models, incentives, roles, and workflows evolve together. AI becomes embedded into how the organization functions.

Stage 5:

> Competing Differently

> AI is no longer visible because it has become part of the organization's DNA. The company creates value in fundamentally new ways that competitors cannot easily replicate. Competitive advantage comes from the transformed organization itself.

Question labels:

> What changes?

> Where does organizational value come from?

> How does leadership evolve?

> What becomes possible next?

Do not invent the final consulting CTA. If the existing site has an approved consulting CTA component, reuse its exact copy and destination after the journey. Otherwise, end on the selected transformation state and record the missing CTA as a limitation.

### Transition

End with the organization's selected current state and one visible connection toward the next state. Do not claim assessment certainty from passive browsing.

### Acceptance test

An executive can identify a recognizable state and explain how value and leadership change at the next state without interpreting a score or checklist.

## 10. Case-study library requirements

Create `case-study-library.md` as a selection library. Do not automatically insert these cases into the homepage.

Include 15-25 cases across all of these categories:

- paradigm shifts reshaping organizations: steam/electrification, computing, internet, mobile, and cloud;
- transitional adoption versus organizational redesign;
- AI-native or AI-led organizational transformation;
- governance enabling trustworthy innovation;
- AI management, stewardship, and organizational memory;
- leadership becoming more valuable as AI capability increases.

For every case include:

1. Title.
2. Organization and date/era.
3. One-paragraph factual summary.
4. The specific argument it supports.
5. The homepage section it maps to.
6. Primary source title, publisher/organization, publication date, and direct URL.
7. Optional secondary source when it materially improves verification.
8. Access date.
9. Verification note distinguishing directly sourced fact from reasonable interpretation.
10. Rights note for any proposed logo, image, or media asset.

Research rules:

- Browse and verify every case.
- Prefer primary sources: company filings, annual reports, official histories, academic research, government archives, standards bodies, or original executive accounts.
- Use reputable secondary sources only when primary evidence is unavailable or insufficient.
- Do not cite search-result pages.
- Exclude any case that cannot be verified.
- Do not fabricate causal claims such as `Company A won solely because it transformed.`
- Keep factual evidence separate from the strategic interpretation.
- Do not copy proprietary diagrams, copy, or visual systems.

The named organizations in Section 1 must also appear in this library with sources supporting the exact claims used on the page.

## 11. Build and verification sequence

1. Inspect the existing site and record the route, tooling, and design-system choices.
2. Create the experiment branch.
3. Write the four Section Design Decisions.
4. Build the structural narrative and transitions without final copy.
5. Implement mandatory animation and interaction.
6. Add exact copy last.
7. Build the verified case-study library separately.
8. Run the repository's relevant tests, typecheck, lint, and production build.
9. Test desktop, 375 px mobile, keyboard-only navigation, and reduced motion.
10. Capture screenshots of all four sections at desktop and mobile.
11. Audit every visible string against the **Copy - exact visible text** lists.
12. Confirm the original homepage file and `/` behavior remain unchanged from `origin/main`.
13. Commit and push only the experiment branch if authorized. Never merge it.

## 12. Final acceptance criteria

Do not report completion unless all statements are true:

- The alternative route loads directly and on refresh.
- `/` still renders the original homepage.
- The original homepage component has no diff from `origin/main`.
- All four sections follow their recorded emotional transformation and misconception.
- The page feels like one continuous documentary.
- Each section's central insight is understandable without explanatory copy.
- Only approved visible copy appears.
- All hover interactions work by keyboard and touch.
- Reduced-motion mode preserves the complete argument.
- Desktop and 375 px layouts have no horizontal overflow or clipped controls.
- There are no console-blocking errors.
- Relevant tests, typecheck, lint, and production build pass, or pre-existing failures are reproduced against `origin/main` and reported precisely.
- The case-study library contains 15-25 verified cases with direct sources and no fabricated claims.
- No case from the library has been inserted into the site unless it was explicitly required in Section 1.
- No commit or merge was made to `main`.

## 13. Final handoff format

Return:

1. Branch name and commit SHA.
2. Alternative route.
3. Changed-file summary.
4. Four-sentence narrative summary, one sentence per section.
5. Verification results.
6. Screenshot links.
7. Case-study library link and number of verified cases.
8. Known limitations and decisions still requiring owner approval.

Do not merge the branch.
