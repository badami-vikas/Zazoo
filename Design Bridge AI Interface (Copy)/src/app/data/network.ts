// Local fallback stub for the real, gitignored network.ts (generated from a LinkedIn export via
// scripts/parse-network.mjs). This file lets a fresh checkout BUILD even without a real export —
// see docs/BUGS.md "Prototype build NOT reproducible". Run parse-network.mjs locally to regenerate
// the real data on this same path; it will overwrite this stub (git will show it as modified — do
// not commit the real export).
//
// This stub intentionally ships EMPTY. Real data always comes from the canonical Supabase tier
// (see data/db.ts: loadCanonicalPeople/loadCanonicalCommunities) or, locally, from a real
// parse-network.mjs export. No placeholder/dummy people are shipped from this fallback — an
// empty result here means the app shows an honest empty state (with an import/connect CTA)
// until a real source is available.

// Loose index signatures on purpose: this stub only needs to satisfy the app's structural
// usage (dozens of optional profile fields across ItemDetail/signals/associations), not
// model the real export precisely — the real parse-network.mjs output does that.
export interface NetworkPerson {
  id: string;
  name: string;
  firstName: string;
  company: string;
  position: string;
  location: string;
  email: string;
  warmth: number;
  ring: string;
  reciprocity: string;
  trust: number;
  lastConnected: string;
  connectedOn: string;
  url: string;
  bio?: string;
  newsInsight?: string;
  websiteUrl?: string;
  githubHandle?: string;
  instagramHandle?: string;
  twitterHandle?: string;
  skills?: string[];
  education?: { institution: string; degree?: string; field?: string; year?: string }[];
  previousCompanies?: { name: string; title?: string; period?: string }[];
  [key: string]: any;
}

export interface NetworkCompany {
  id: string;
  name: string;
  newsInsight: string;
  connections: number;
  sampleRoles?: string[];
  samplePeople?: string[];
  [key: string]: any;
}

export interface NetworkThread {
  id: string;
  with: string;
  to?: string;
  from?: string;
  direction: string;
  message: string;
  date?: string;
  [key: string]: any;
}

export const people: NetworkPerson[] = [];

export const companies: NetworkCompany[] = [];

export const threads: NetworkThread[] = [];

export const totalConnections = people.length;
