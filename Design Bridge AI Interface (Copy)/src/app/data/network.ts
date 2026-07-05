// dummy_ stub for the real, gitignored network.ts (generated from your LinkedIn export via
// scripts/parse-network.mjs). This file is what makes a fresh checkout BUILD — see known-issues.md
// "Prototype build NOT reproducible" (2026-07-03). Run parse-network.mjs locally to regenerate the
// real data on this same path; it will overwrite this stub (git will show it as modified — do not
// commit the real export). All values here are dummy_-prefixed placeholders, no real PII.

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

export const people: NetworkPerson[] = [
  { id: 'dummy_p1', name: 'dummy_Alex Founder', firstName: 'dummy_Alex', company: 'dummy_Northwind Ventures', position: 'Co-founder & CEO', location: 'San Francisco, CA', email: 'dummy_alex@example.com', warmth: 84, ring: 'Inner', reciprocity: 'Balanced', trust: 88, lastConnected: '04 Apr 2026', connectedOn: '12 Jan 2024', url: 'https://linkedin.com/in/dummy_alex' },
  { id: 'dummy_p2', name: 'dummy_Bree Partner', firstName: 'dummy_Bree', company: 'dummy_Ridgeline Capital', position: 'General Partner', location: 'New York, NY', email: 'dummy_bree@example.com', warmth: 71, ring: 'Active', reciprocity: 'You give more', trust: 68, lastConnected: '18 Feb 2026', connectedOn: '03 Jun 2023', url: 'https://linkedin.com/in/dummy_bree' },
  { id: 'dummy_p3', name: 'dummy_Chen Advisor', firstName: 'dummy_Chen', company: 'dummy_Meridian Labs', position: 'Advisor', location: 'Austin, TX', email: '', warmth: 55, ring: 'Extended', reciprocity: 'Balanced', trust: 60, lastConnected: '02 Nov 2025', connectedOn: '21 Sep 2022', url: '' },
  { id: 'dummy_p4', name: 'dummy_Dana Engineer', firstName: 'dummy_Dana', company: 'dummy_Northwind Ventures', position: 'Head of Engineering', location: 'Remote', email: 'dummy_dana@example.com', warmth: 62, ring: 'Warm', reciprocity: 'They give more', trust: 71, lastConnected: '30 Mar 2026', connectedOn: '15 Jan 2024', url: 'https://linkedin.com/in/dummy_dana' },
  { id: 'dummy_p5', name: 'dummy_Eli Investor', firstName: 'dummy_Eli', company: 'dummy_Ridgeline Capital', position: 'Investor', location: 'Boston, MA', email: 'dummy_eli@example.com', warmth: 47, ring: 'Dormant', reciprocity: 'Balanced', trust: 50, lastConnected: '11 Jul 2024', connectedOn: '08 Feb 2021', url: '' },
  { id: 'dummy_p6', name: 'dummy_Farah Recruiter', firstName: 'dummy_Farah', company: 'dummy_Meridian Labs', position: 'Talent Partner', location: 'Chicago, IL', email: 'dummy_farah@example.com', warmth: 66, ring: 'Active', reciprocity: 'Balanced', trust: 64, lastConnected: '22 Jan 2026', connectedOn: '19 Nov 2023', url: 'https://linkedin.com/in/dummy_farah' },
];

export const companies: NetworkCompany[] = [
  { id: 'dummy_c1', name: 'dummy_Northwind Ventures', newsInsight: 'dummy_2 people you know here.', connections: 2, sampleRoles: ['CEO', 'Head of Engineering'], samplePeople: ['dummy_Alex Founder', 'dummy_Dana Engineer'] },
  { id: 'dummy_c2', name: 'dummy_Ridgeline Capital', newsInsight: 'dummy_2 people you know here.', connections: 2, sampleRoles: ['General Partner', 'Investor'], samplePeople: ['dummy_Bree Partner', 'dummy_Eli Investor'] },
  { id: 'dummy_c3', name: 'dummy_Meridian Labs', newsInsight: 'dummy_2 people you know here.', connections: 2, sampleRoles: ['Advisor', 'Talent Partner'], samplePeople: ['dummy_Chen Advisor', 'dummy_Farah Recruiter'] },
];

export const threads: NetworkThread[] = [
  { id: 'dummy_t1', with: 'dummy_Alex Founder', from: 'dummy_Alex Founder', direction: 'incoming', message: 'dummy_Great catching up last week — let’s follow up on the intro.', date: '02 Apr 2026' },
  { id: 'dummy_t2', with: 'dummy_Bree Partner', to: 'dummy_Bree Partner', direction: 'outgoing', message: 'dummy_Sending over the deck we discussed.', date: '15 Feb 2026' },
];

export const totalConnections = people.length;
