export interface LinkedInExperience {
  title: string;
  company: string;
  companyType?: string; // "Full-time", "Contract", etc.
  companyUrl?: string;  // LinkedIn company page → feeds Community creation/enrichment
  duration: string;
  location?: string;
  description?: string;
}

export interface LinkedInEducation {
  school: string;
  schoolUrl?: string;   // LinkedIn school page → feeds Community creation/enrichment
  degree?: string;
  field?: string;
  years?: string;
}

export interface LinkedInPost {
  url: string;          // link to the post (no text captured by design)
  meta?: string;        // e.g. "Reposted · 2w" or "Mehmet posted this"
}

export interface LinkedInProfile {
  url: string;
  handle: string;
  name: string;
  headline: string;
  location: string;
  about: string;
  experience: LinkedInExperience[];
  education: LinkedInEducation[];
  services: string[];    // LinkedIn Services section → tags on the Bridge person page
  posts: LinkedInPost[]; // recent activity (capped at 3)
  extractedAt: string;

  // Topcard extras — always available even when full sections are gated.
  photoUrl?: string;
  currentCompany?: string;   // company chip in the topcard
  currentSchool?: string;    // school chip in the topcard

  /** True when LinkedIn's "golden gate" blurs the full profile for the
   *  viewing account (viewer hasn't added a job/school). Sections are then
   *  ABSENT from the DOM — only topcard data is extractable. */
  gated: boolean;
}

export type ExtractResult =
  | { ok: true; profile: LinkedInProfile }
  | { ok: false; error: string };

export interface ImportResult {
  ok: boolean;
  stagingCount?: number;
  dedup_key?: string;
  error?: string;
}
