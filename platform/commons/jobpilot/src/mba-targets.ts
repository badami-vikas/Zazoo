// Curated full-time post-MBA recruiting targets.
//
// Why this is DATA and not a connector: Greenhouse/Ashby/Lever JSON carries no
// application-deadline field, and the employers that run structured MBA
// full-time hiring (MBB, Big 4 strategy, corporate LDPs) are not on those ATSs
// at all — they recruit through their own portals and school systems (12Twenty,
// Symplicity, Handshake) that have no public API and whose terms forbid
// scraping. A deadline therefore cannot be sourced; it has to be entered. This
// file is that entry point, and `jobpilot_jobs.deadline` is where it lands.
//
// ADR-247 — never fabricate a figure. A deadline nobody has verified is `null`
// with `deadlineNote` saying what IS known ("rolling, opens August"), never a
// plausible-looking date. Callers must treat null as "go look it up", not "no
// deadline".

/** How reliably the employer sponsors work visas for US MBA-level hires.
 * Grounded in published H-1B filing behaviour, not recruiter marketing —
 * verify against the DOL LCA disclosure files before betting a cycle on it. */
export type SponsorshipTier =
  | "reliable" // files at MBA level every year; refiles or relocates if the lottery is lost
  | "selective" // sponsors, but varies by office/practice — confirm with the recruiter
  | "mba_only" // sponsors MBA hires but not undergrad
  | "none"; // does not sponsor US hires at this level

export interface MbaTarget {
  company: string;
  /** Full-time post-MBA role. Internships are out of scope for this list. */
  role: string;
  /** ISO calendar day, or null when no date is verified — see the file header. */
  deadline: string | null;
  /** What is actually known about timing when `deadline` is null. */
  deadlineNote: string | null;
  sponsorship: SponsorshipTier;
  /** Where the deadline/sponsorship claim came from, so a stale row is auditable. */
  source: string;
  applyUrl: string | null;
  /** US unless stated — sponsorship only means something against a jurisdiction. */
  geography: string;
}

/**
 * The honest shape of September for a second-year MBA: almost nothing in the US
 * has a hard September full-time deadline. MBB US full-time lands October to
 * November; September is when the ROLLING pipelines (Deloitte S&O, EY-Parthenon,
 * L.E.K.) are open and filling their best offices. Rows here are therefore
 * mostly `deadline: null` with a rolling note — that is the accurate answer, and
 * a table of invented September dates would be a worse one.
 */
export const MBA_FULL_TIME_TARGETS: readonly MbaTarget[] = [
  {
    company: "BCG",
    role: "Consultant, Full-Time MBA",
    deadline: "2026-09-11",
    deadlineNote: null,
    sponsorship: "reliable",
    source: "managementconsulted.com application tracker, retrieved 2026-09-02",
    applyUrl: "https://careers.bcg.com/global/en/featured-events/united-states-international-events",
    geography: "Global (ex-US & Canada)",
  },
  {
    company: "Deloitte",
    role: "Strategy & Operations / Monitor Deloitte — Consultant",
    deadline: null,
    deadlineNote: "Rolling. Strategy offices fill by September — applying in October is late.",
    sponsorship: "reliable",
    source: "roadtooffer.com consulting deadlines 2026, retrieved 2026-09-02",
    applyUrl: null,
    geography: "US",
  },
  {
    company: "EY-Parthenon",
    role: "Consultant (post-MBA)",
    deadline: null,
    deadlineNote: "Rolling, campus-specific; window opened July, full-time decisions Oct-Nov.",
    sponsorship: "reliable",
    source: "roadtooffer.com consulting deadlines 2026, retrieved 2026-09-02",
    applyUrl: null,
    geography: "US",
  },
  {
    company: "L.E.K. Consulting",
    role: "Consultant (post-MBA)",
    deadline: null,
    deadlineNote: "Rolling Aug-Oct; life sciences and PE practices.",
    sponsorship: "mba_only",
    source: "hackingthecaseinterview.com sponsorship table, retrieved 2026-09-02",
    applyUrl: null,
    geography: "US",
  },
  {
    company: "Kearney",
    role: "Associate (post-MBA)",
    deadline: null,
    deadlineNote: "Some offices Aug-Sept, most Oct-Nov.",
    sponsorship: "mba_only",
    source: "hackingthecaseinterview.com sponsorship table, retrieved 2026-09-02",
    applyUrl: null,
    geography: "US",
  },
  {
    company: "KPMG",
    role: "Full-Time Consultant & Senior Consultant",
    deadline: null,
    deadlineNote: "Expected September 2026 — Toronto only, not a US requisition.",
    sponsorship: "selective",
    source: "managementconsulted.com application tracker, retrieved 2026-09-02",
    applyUrl: null,
    geography: "Canada",
  },
  {
    company: "McKinsey",
    role: "Associate (MBA)",
    deadline: null,
    deadlineNote: "US full-time Oct-Nov; campus deadline via Handshake can be 2-4 weeks earlier.",
    sponsorship: "reliable",
    source: "roadtooffer.com consulting deadlines 2026, retrieved 2026-09-02",
    applyUrl: null,
    geography: "US",
  },
  {
    company: "Bain",
    role: "Consultant (MBA)",
    deadline: null,
    deadlineNote: "US full-time Oct-Nov. Typically files H-1B once, then L-1 via an overseas office.",
    sponsorship: "reliable",
    source: "hackingthecaseinterview.com sponsorship table, retrieved 2026-09-02",
    applyUrl: null,
    geography: "US",
  },
  {
    company: "Strategy&",
    role: "Senior Associate (post-MBA)",
    deadline: null,
    deadlineNote: "Unverified — confirm on the PwC campus portal.",
    sponsorship: "reliable",
    source: "hackingthecaseinterview.com sponsorship table, retrieved 2026-09-02",
    applyUrl: null,
    geography: "US",
  },
];

/** Targets whose VERIFIED deadline falls in the given month (`"2026-09"`).
 * Null-deadline rows are excluded by construction — an unverified date is not a
 * match, and pretending otherwise is the exact failure mode this module avoids.
 * Use `unverifiedTargets` to get the rows a human still has to go check. */
export function targetsClosingIn(month: string): MbaTarget[] {
  return MBA_FULL_TIME_TARGETS.filter((t) => t.deadline?.startsWith(month));
}

/** The other half of the answer: rows with a real opportunity but no confirmed
 * date. Surfaced rather than silently dropped, so "5 results" is never mistaken
 * for "5 opportunities exist". */
export function unverifiedTargets(): MbaTarget[] {
  return MBA_FULL_TIME_TARGETS.filter((t) => t.deadline === null);
}

/** Employers worth an international candidate's application at all. `none` is
 * excluded — applying there burns a slot the lottery math cannot afford. */
export function sponsoringTargets(): MbaTarget[] {
  return MBA_FULL_TIME_TARGETS.filter((t) => t.sponsorship !== "none");
}
