export interface LinkedInExperience {
  title: string;
  company: string;
  companyType?: string; // "Full-time", "Contract", etc.
  duration: string;
  location?: string;
  description?: string;
}

export interface LinkedInEducation {
  school: string;
  degree?: string;
  field?: string;
  years?: string;
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
  skills: string[];
  extractedAt: string;
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
