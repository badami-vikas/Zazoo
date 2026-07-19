export type ArtifactStatus = 'ready' | 'review' | 'practice' | 'blocked';
export type EvidenceStatus = 'verified' | 'needs-review';

export interface ApplicationArtifact {
  id: string;
  title: string;
  description: string;
  status: ArtifactStatus;
  ownerAgent: string;
  skill: string;
  updated: string;
  sections: { heading: string; body: string; bullets?: string[] }[];
  /** IDs of evidence[] items that ground the claims in this artifact */
  evidenceIds?: readonly string[];
}

export interface EvidenceClaim {
  id: string;
  claim: string;
  source: string;
  status: EvidenceStatus;
  note?: string;
}

/** JP3B (TASK-011) — culture research is now LIVE (queried from the API by
 * `CultureResearchSection`, see `../pages/JobPilotApplicationDetail.tsx` and
 * `./culture-research-client.ts`), not hand-authored static data — TASK-011
 * remediation (2026-07-18 coordinator final review, issue 7). This file no
 * longer carries a `cultureResearch` block or its types.
 */

export const BCG_APPLICATION = {
  id: 'bcg-consultant-mba-2026',
  company: 'Boston Consulting Group',
  companyShort: 'BCG',
  role: 'Consultant — MBA',
  location: 'United States · office preference required',
  stage: 'Application preparation',
  targetWindow: 'MBA recruiting cycle · confirm office deadline',
  lastUpdated: 'July 15, 2026',
  source: {
    label: 'BCG Careers · consulting application and interview guidance',
    url: 'https://careers.bcg.com/global/en/interview-process',
  },
  fit: {
    recommendation: 'Pursue',
    summary: 'Strong founder-to-consultant story with unusual operating depth, measurable client outcomes, global exposure, and a current STEM MBA. The application is strongest when it leads with structured impact and treats the founder transition as a deliberate next chapter—not an escape from entrepreneurship.',
    strengths: [
      'Built and turned around a consulting-led venture, then delivered measurable growth and transformation outcomes across industries.',
      'Combines strategy, behavioral design, AI, and hands-on implementation—the kind of range useful in ambiguous client work.',
      'Demonstrated leadership without formal authority across distributed teams, volunteers, executives, and public stakeholders.',
      'Current Olin STEM MBA, Dean’s Scholar, and 98th-percentile GMAT provide a clear academic signal.',
    ],
    concerns: [
      'Several older source documents conflict on PeopleGamez dates, grant totals, and selected project metrics; only reconciled claims should ship.',
      'Office preference and specific recruiting channel are not yet chosen, so “Why this office?” and deadline fields remain open.',
      'Resume is dense. Final one-page version needs strict prioritization and a recruiter scan before submission.',
    ],
    dimensions: [
      { label: 'Integrity', evidence: 'Owned a business failure, supported laid-off teammates, and rebuilt trust; evidence conflicts remain surfaced for review.' },
      { label: 'Intellectual curiosity', evidence: 'Worked across industrial engineering, AI, behavioral science, strategy, venture diligence, and operating transformation.' },
      { label: 'Creative thinking', evidence: 'Designed simulation-led products, a recurring M&A model, and AI-enabled operating solutions.' },
      { label: 'Collaborative mindset', evidence: 'Led cross-functional client teams, a 22-person volunteer network, and multi-country technical teams.' },
      { label: 'Drive', evidence: 'Rebuilt a venture after bankruptcy, won competitive grants, and scaled education programs to 10,000+ students.' },
    ],
  },
  submission: {
    requiresHumanApproval: true,
    status: 'blocked' as const,
    blockers: ['Choose BCG office preferences', 'Confirm recruiting link and deadline', 'Resolve three evidence conflicts', 'Approve final one-page resume'],
  },
  evidence: [
    { id: 'mba', claim: 'STEM MBA candidate at Washington University in St. Louis, expected May 2027; Dean’s Scholar on full merit scholarship.', source: 'Master Profile → Washington University education record', status: 'verified' as const },
    { id: 'gmat', claim: 'GMAT Focus 695, 98th percentile.', source: 'Master Profile → Washington University test scores', status: 'verified' as const },
    { id: 'peoplegamez-dates', claim: 'PeopleGamez / MetaXP: August 2021–July 2025.', source: 'Master Profile → PeopleGamez canonical dates', status: 'needs-review' as const, note: 'Source files also show Feb 2021–Present and Apr 2022–Present. Confirm the employment framing before submission.' },
    { id: 'growthpal', claim: 'Repositioned GrowthPal around a subscription model, reduced sales cycle about 40%, and grew deal size 6x to $30K.', source: 'Master Profile → PeopleGamez client projects → GrowthPal', status: 'verified' as const },
    { id: 'forensics', claim: 'Reclaimed 6 of 8 enterprise clients and increased LTV 18% through an AI-enabled digital-forensics process.', source: 'Master Profile → PeopleGamez client projects → Bluechip Digital Forensics', status: 'verified' as const },
    { id: 'fintech', claim: 'Used market research, interviews, survey outreach, testing, and modeling to redirect a fintech roadmap and halve time to market.', source: 'Master Profile → PeopleGamez client projects → Jugad', status: 'verified' as const },
    { id: 'opentech', claim: 'Built a 22-person volunteer team that helped 10,000+ students across 30+ institutions use technology on community problems.', source: 'Master Profile → OpenTech', status: 'verified' as const },
    { id: 'grant', claim: 'Won $21K in government innovation grants.', source: 'Master Profile → PeopleGamez achievements and awards', status: 'needs-review' as const, note: 'Other drafts cite $12K, $18K, or an additional $8.5K TIDE grant. Use the award letters to reconcile.' },
    { id: 'learners', claim: 'Scaled simulation-led programs to 40,000+ learners across seven countries.', source: 'Master Profile → PeopleGamez achievements', status: 'verified' as const },
    { id: 'arcesium', claim: 'Built a computer-vision and NLP records process that reduced processing time about 30%.', source: 'Master Profile → Plaksha capstone → Arcesium', status: 'verified' as const },
    { id: 'pi-school', claim: 'Selected as a special 21st scholar for 20 places from 6,000+ applicants.', source: 'Master Profile → Pi School of AI', status: 'verified' as const },
    { id: 'funding', claim: 'Marketplace strategy contributed to three bank MOUs and $10M in funding.', source: 'Master Profile → Singapore-HQ analytics venture', status: 'needs-review' as const, note: 'Confirm whether “catalyzed” or “enabled” best reflects causal attribution.' },
  ] satisfies EvidenceClaim[],
  artifacts: [
    {
      id: 'resume', title: 'BCG one-page resume', description: 'Impact-first MBA consulting resume with evidence links', status: 'review', ownerAgent: 'Materials Writer', skill: 'tailor resume', updated: 'Draft 1 · July 15', evidenceIds: ['mba', 'gmat', 'peoplegamez-dates', 'growthpal', 'forensics', 'fintech', 'opentech', 'grant', 'learners', 'arcesium', 'pi-school', 'funding'] as const,
      sections: [
        { heading: 'Header', body: 'VIKAS BADAMI · St. Louis, MO · 314-240-3755 · badami@wustl.edu · linkedin.com/in/vikasbadami' },
        { heading: 'Education', body: 'WASHINGTON UNIVERSITY IN ST. LOUIS — Olin Business School · St. Louis, MO\nSTEM MBA, Consulting Specialization · Expected May 2027\nDean’s Scholar (100% merit scholarship); GMAT Focus 695 (98th percentile); Entrepreneurship Hackathon Winner; SVC semifinalist (135 teams); Redstick Ventures diligence capstone.' },
        { heading: 'Experience — PeopleGamez / MetaXP', body: 'FOUNDER & PRINCIPAL CONSULTANT · India · Aug 2021–Jul 2025 [date under review]', bullets: [
          'Repositioned an M&A marketplace as an extended CFO team with a recurring subscription model, cutting the sales cycle ~40% and increasing deal size 6x to $30K while supporting European expansion.',
          'Reclaimed 6 of 8 enterprise clients lost to an AI-first competitor by architecting an AI-enabled digital-forensics process, increasing client lifetime value 18%.',
          'Redirected a VC-backed fintech roadmap using competitive research, 100+ interviews, 1,000+ survey outreach, A/B testing, and profitability modeling, halving time to market.',
          'Scaled simulation-led transformation programs to 40,000+ learners across seven countries through partnerships serving Amazon, Genpact, Dr. Reddy’s, SHRM, NTUC, and SportsSG.',
        ] },
        { heading: 'Experience — OpenTech', body: 'FOUNDER & CHIEF FACILITATOR · India · Oct 2016–Jan 2025 (part-time)', bullets: [
          'Built and led a 22-person volunteer team that helped 10,000+ students from underserved communities create technology solutions; participants launched 30+ ventures and one represented India at NASA.',
          'Adapted the program online during the pandemic; Project Uplift earned a top-three Asia recognition from United People Global.',
        ] },
        { heading: 'Earlier education & leadership', body: 'PLAKSHA UNIVERSITY — PGDM, Tech Leaders Fellowship; full merit scholarship. Built a computer-vision/NLP process for Arcesium that reduced processing time ~30%.\nNIT CALICUT — B.Tech, Industrial Engineering; top 10% of class. Founding captain of the institute’s Kho-Kho team; Government of India Toycathon winner.' },
        { heading: 'Additional', body: 'Tools: Excel, Power BI, Tableau, SQL, Python, Salesforce, HubSpot · National-level Kho-Kho player · State-level chess player · Working knowledge of seven languages.' },
      ],
    },
    {
      id: 'cover-letter', title: 'BCG cover letter', description: 'Concise founder-to-consultant narrative; office paragraph held open', status: 'review', ownerAgent: 'Materials Writer', skill: 'tailor cover letter', updated: 'Draft 1 · July 15', evidenceIds: ['mba', 'gmat', 'growthpal', 'forensics', 'fintech', 'opentech', 'learners', 'funding'] as const,
      sections: [
        { heading: 'Draft', body: `Dear BCG Recruiting Team,

I am excited to apply for the Consultant role at Boston Consulting Group. Building PeopleGamez taught me to turn ambiguity into measurable outcomes: I repositioned an M&A marketplace around a recurring model that cut its sales cycle by roughly 40%, helped an enterprise technology client reclaim six of eight customers lost to an AI-first competitor, and used customer research and profitability modeling to halve a fintech venture’s time to market. I am pursuing my STEM MBA at Washington University’s Olin Business School to add greater analytical depth and enterprise scale to that operating experience.

BCG appeals to me because its interviews and work reward the same combination I have learned to value—intellectual curiosity, creative problem solving, collaboration, and the integrity to surface uncertainty. My work has crossed strategy, AI, behavioral design, and implementation, but the common thread is helping diverse teams make difficult changes together. That has meant influencing founders to abandon invested roadmaps, aligning public stakeholders around a new industry policy, and leading volunteers without formal authority to help more than 10,000 students build solutions for their communities.

I would bring an entrepreneurial bias toward action, comfort with imperfect information, and humility earned through failure. After my venture neared bankruptcy, I owned the mistakes, supported teammates through the closure, and rebuilt the business from a board-game café. That experience made me a more candid, resilient, and empathetic leader—and is central to the consultant I hope to become.

[Add two sentences connecting a chosen BCG office, its people, and relevant work to your background after networking conversations.]

Thank you for your consideration. I would welcome the opportunity to discuss how my operating experience, analytical curiosity, and collaborative leadership could contribute to BCG and its clients.

Sincerely,\nVikas Badami` },
        { heading: 'Human review', body: 'Choose the office and add one specific, evidenced reason from a real BCG conversation. Do not submit the bracketed placeholder.' },
      ],
    },
    {
      id: 'application-answers', title: 'Application answer bank', description: 'Reusable answers with sensitive fields left to the candidate', status: 'review', ownerAgent: 'Application Coordinator', skill: 'match answers', updated: '5 answers · 2 open', evidenceIds: ['opentech', 'growthpal', 'forensics', 'fintech'] as const,
      sections: [
        { heading: 'Why consulting?', body: 'I have spent my career helping founders and teams act on ambiguous problems, from changing a fintech roadmap to rebuilding a struggling venture. Consulting is the deliberate next step: it lets me bring that operating empathy to a wider range of high-stakes problems while developing more rigorous, repeatable approaches to enterprise transformation.' },
        { heading: 'Why BCG?', body: 'BCG’s stated emphasis on integrity, curiosity, creative thinking, collaboration, and drive closely matches how I have learned to create impact. I am especially drawn to a culture that expects both original thinking and candid teamwork—not polished certainty—and to the chance to pair strategy with implementation at a scale I could not reach as a founder.' },
        { heading: 'Leadership example', body: 'At OpenTech, I built a 22-person volunteer team without financial incentives and partnered with schools and NGOs to help 10,000+ underserved students build technology solutions. I learned to create ownership through purpose, clear roles, and peer mentorship rather than positional authority.' },
        { heading: 'Failure and learning', body: 'When PeopleGamez neared bankruptcy, I had to lay off teammates because of decisions I owned. I met each person, explained the situation candidly, used personal savings for support, and helped with transitions. Several later returned as collaborators. I learned that leadership credibility is built most deeply when the news is bad.' },
        { heading: 'Open fields', body: 'Work authorization, sponsorship, office preferences, start-date flexibility, and voluntary demographic answers require direct candidate input. JobPilot will not infer them.' },
      ],
    },
    {
      id: 'networking', title: 'Networking plan', description: 'Warm, specific outreach and learning goals—not referral harvesting', status: 'practice', ownerAgent: 'Search Strategist', skill: 'assess source strategy', updated: '4-week plan',
      sections: [
        { heading: 'Who to contact', body: 'Prioritize Olin alumni and second-degree contacts in your target offices: post-MBA Consultants (recent transition), Project Leaders (staffing and development), and one recruiting contact. Seek perspective across entrepreneurship, digital/AI, organizational transformation, and social impact.' },
        { heading: 'Outreach note', body: 'Hi [Name] — I’m a STEM MBA candidate at Olin and former founder preparing for BCG recruiting. Your path from [specific shared point] to [office/practice] stood out. I’d value 20 minutes to understand what surprised you about the transition and how your office helps entrepreneurial hires turn operating experience into client impact. I’m not asking for a referral—your perspective would help me make a more informed choice. Thank you, Vikas' },
        { heading: 'Conversation questions', body: 'Ask: What distinguishes strong founder-to-consultant transitions? How does the office balance creative answers with rigorous team problem solving? What feedback most accelerated your growth? Which local work would connect naturally to my strategy + AI + behavioral-design background? What should I test about my own fit before applying?' },
        { heading: 'Follow-through', body: 'Record specific insights, send a short thank-you within 24 hours, update the office paragraph only with permission-safe facts, and keep each relationship useful even if no referral emerges.' },
      ],
    },
    {
      id: 'behavioral-stories', title: 'Behavioral story bank', description: 'Five 90-second stories mapped to BCG dimensions', status: 'practice', ownerAgent: 'Interview Prep', skill: 'prepare interview brief', updated: '5 stories mapped', evidenceIds: ['growthpal', 'forensics', 'fintech', 'opentech', 'funding'] as const,
      sections: [
        { heading: 'Drive — rebuilding after failure', body: 'Situation: PeopleGamez neared bankruptcy. Task: protect people while finding a viable model. Action: owned the failure, supported transitions, operated from a café, shadowed practitioners, and rebuilt around consulting outcomes. Result: restored trust, former teammates returned as collaborators, and the firm delivered transformation work across markets. Reflection: resilience is an obligation to learn, not merely endure.' },
        { heading: 'Creative thinking — GrowthPal model', body: 'Situation: volatile success-fee revenue weakened predictability. Task: create recurring value for CFOs. Action: reframed the company as an extended M&A team, designed a vetted subscription offer, and built the sales playbook. Result: ~40% shorter sales cycle and 6x larger deal size to $30K. Reflection: the best model change aligns customer risk with operating economics.' },
        { heading: 'Collaborative mindset — OpenTech volunteers', body: 'Situation: students in remote communities lacked access and volunteers had no financial incentive. Task: build a durable delivery network. Action: created mentorship circles, distributed ownership, and aligned schools, NGOs, and government partners. Result: 22 volunteers served 10,000+ students. Reflection: people sustain difficult work when they can see their agency in the outcome.' },
        { heading: 'Intellectual curiosity — fintech pivot', body: 'Situation: a founder had committed capital and identity to a weak roadmap. Task: test the underlying assumptions without triggering defensiveness. Action: combined competitor research, interviews, survey outreach, A/B tests, and profitability modeling; invited the founder into the evidence review. Result: roadmap changed and time to market halved. Reflection: curiosity is most useful when it makes it safe to change one’s mind.' },
        { heading: 'Integrity — team closure', body: 'Situation: business decisions led to layoffs. Task: communicate honestly and act fairly despite limited cash. Action: met each teammate, took responsibility, offered support from personal savings, and helped with new roles. Result: relationships survived and several teammates later referred work or returned. Reflection: trust depends on what a leader does when incentives favor avoidance.' },
      ],
    },
    {
      id: 'case-prep', title: 'Case interview plan', description: 'Six-week practice system using official BCG case guidance', status: 'practice', ownerAgent: 'Interview Prep', skill: 'prepare interview brief', updated: 'Week 1 of 6',
      sections: [
        { heading: 'BCG case behaviors', body: 'Practice active listening, clear structure, explicit assumptions, visible calculation work, concise synthesis, and creative business judgment. Treat the case as a collaborative problem-solving conversation rather than a memorized framework recital.' },
        { heading: 'Weeks 1–2 · foundations', body: 'Complete three solo structures and two live cases each week. Drill market sizing, breakeven, weighted averages, growth, and chart reading for 20 minutes daily. After each case, write one structural miss, one calculation miss, and one communication fix.' },
        { heading: 'Weeks 3–4 · range and pressure', body: 'Complete four live cases weekly across profitability, growth, market entry, operations, digital, and public/social impact. Add time pressure and interviewer-led pivots. Practice 30-second synthesis after every exhibit.' },
        { heading: 'Weeks 5–6 · simulation', body: 'Run two full mock rounds weekly with behavioral opening, case, recommendation, and candidate questions. Track repeated feedback by behavior. Final week: reduce volume, keep math warm, and prioritize calm, curiosity, and crisp communication.' },
        { heading: 'Scorecard', body: 'Rate 1–5 after every case: problem definition, structure, hypothesis, data interpretation, calculation accuracy, creativity, collaboration, executive synthesis, and recovery after a mistake.' },
      ],
    },
    {
      id: 'interviewer-questions', title: 'Questions for BCG interviewers', description: 'Questions that test mutual fit and invite specific experience', status: 'ready', ownerAgent: 'Interview Prep', skill: 'prepare interview brief', updated: '8 questions',
      sections: [
        { heading: 'Office and work', body: 'Which problems are creating the most energy in this office right now? How has the office’s client mix changed the way teams build expertise? Where do people with founder or operator backgrounds tend to add distinctive value?' },
        { heading: 'Learning and feedback', body: 'What piece of feedback most changed how you work with clients? What separates people who progress quickly from those who are simply strong problem solvers? How do teams create room for a junior person to challenge the emerging answer?' },
        { heading: 'Culture and fit', body: 'Can you share a moment when collaboration materially improved the answer? What has kept you at BCG that you could not have known before joining?' },
      ],
    },
    {
      id: 'submission-checklist', title: 'Submission checklist', description: 'Exact human-controlled gate before anything leaves JobPilot', status: 'blocked', ownerAgent: 'Application Coordinator', skill: 'prepare handoff', updated: '4 of 10 ready', evidenceIds: ['peoplegamez-dates', 'grant', 'funding', 'mba'] as const,
      sections: [
        { heading: 'Before review', body: 'Confirm exact role and recruiting channel; choose up to the allowed office preferences; verify office deadlines; reconcile PeopleGamez dates, grant amount, and funding attribution; reduce resume to one page; spell-check and ATS-render; add office-specific cover-letter paragraph.' },
        { heading: 'Human approval packet', body: 'Show the exact resume version, cover letter, office choices, education fields, work history, answer values, destination URL, permissions, and submission consequence. Work authorization, sponsorship, and demographic fields remain candidate-entered.' },
        { heading: 'After submission', body: 'Save the confirmation and sent file versions; record the Application Event; schedule a follow-up checkpoint; begin the six-week interview plan without assuming progression.' },
      ],
    },
  ] satisfies ApplicationArtifact[],
  sources: [
    { label: 'Candidate Master Profile', detail: 'Compiled from 45+ supplied resumes, cover letters, recommendations, and application essays.' },
    { label: 'BCG interview process', detail: 'Official evaluation dimensions and interview stages.' },
    { label: 'BCG case preparation', detail: 'Official case behaviors: structure, questions, analysis, calculations, communication, and creativity.' },
    { label: 'Existing consulting materials', detail: 'Consulting resume and cover-letter drafts supplied in Tools/Job/Job Application.' },
    { label: 'JobPilot BRD', detail: 'Agent ownership, evidence traceability, sensitive-field handling, and mandatory Human submission approval.' },
  ],
} as const;

export function artifactById(id: string) {
  return BCG_APPLICATION.artifacts.find((artifact) => artifact.id === id);
}
