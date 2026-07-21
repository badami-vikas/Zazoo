import { z } from "zod";

// JSON Resume schema — typed contract for the master profile and all tailored materials.
// Field names match the upstream spec exactly (MIT: https://github.com/jsonresume/resume-schema).
// All resume data in JobPilot flows through this contract so the truthfulness gate and
// field-level provenance tracking operate on a known, stable shape.

export const LocationSchema = z.object({
  address: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  countryCode: z.string().optional(),
  region: z.string().optional(),
});

export const ProfileLinkSchema = z.object({
  network: z.string(),
  username: z.string(),
  url: z.string().optional(),
});

export const BasicsSchema = z.object({
  name: z.string().optional(),
  label: z.string().optional(),
  image: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  url: z.string().optional(),
  summary: z.string().optional(),
  location: LocationSchema.optional(),
  profiles: z.array(ProfileLinkSchema).optional(),
});

// PROTECTED_FIELD group — same as evaluator.ts PROTECTED_FIELDS; duplicated here as type-level
// constants so schema consumers can enumerate the fields that cannot be jd_added.
export const PROTECTED_WORK_FIELDS = ["name", "position", "startDate", "endDate"] as const;
export const PROTECTED_EDUCATION_FIELDS = ["institution", "studyType", "startDate", "endDate"] as const;

export const WorkEntrySchema = z.object({
  name: z.string(), // employer/company name — PROTECTED
  position: z.string(), // job title — PROTECTED
  url: z.string().optional(),
  startDate: z.string().optional(), // ISO date string — PROTECTED
  endDate: z.string().optional(), // PROTECTED
  summary: z.string().optional(),
  highlights: z.array(z.string()).optional(),
});

export const VolunteerEntrySchema = z.object({
  organization: z.string(),
  position: z.string().optional(),
  url: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  summary: z.string().optional(),
  highlights: z.array(z.string()).optional(),
});

export const EducationEntrySchema = z.object({
  institution: z.string(), // PROTECTED
  url: z.string().optional(),
  area: z.string().optional(),
  studyType: z.string().optional(), // degree type — PROTECTED
  startDate: z.string().optional(), // PROTECTED
  endDate: z.string().optional(), // PROTECTED
  score: z.string().optional(),
  courses: z.array(z.string()).optional(),
});

export const AwardSchema = z.object({
  title: z.string(),
  date: z.string().optional(),
  awarder: z.string().optional(),
  summary: z.string().optional(),
});

export const CertificateSchema = z.object({
  name: z.string(),
  date: z.string().optional(),
  issuer: z.string().optional(),
  url: z.string().optional(),
});

export const PublicationSchema = z.object({
  name: z.string(),
  publisher: z.string().optional(),
  releaseDate: z.string().optional(),
  url: z.string().optional(),
  summary: z.string().optional(),
});

export const SkillSchema = z.object({
  name: z.string(),
  level: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});

export const LanguageSchema = z.object({
  language: z.string(),
  fluency: z.string().optional(),
});

export const InterestSchema = z.object({
  name: z.string(),
  keywords: z.array(z.string()).optional(),
});

export const ReferenceSchema = z.object({
  name: z.string(),
  reference: z.string().optional(),
});

export const ProjectSchema = z.object({
  name: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  description: z.string().optional(),
  highlights: z.array(z.string()).optional(),
  url: z.string().optional(),
  roles: z.array(z.string()).optional(),
  entity: z.string().optional(),
  type: z.string().optional(),
});

// Top-level JSON Resume document. All sections optional so a partially-parsed resume is still a
// valid schema value (missing fields are tracked as NeedsHuman at the master-profile layer, not
// here). The `$schema` key is allowed and ignored.
export const JsonResumeSchema = z.object({
  $schema: z.string().optional(),
  basics: BasicsSchema.optional(),
  work: z.array(WorkEntrySchema).optional(),
  volunteer: z.array(VolunteerEntrySchema).optional(),
  education: z.array(EducationEntrySchema).optional(),
  awards: z.array(AwardSchema).optional(),
  certificates: z.array(CertificateSchema).optional(),
  publications: z.array(PublicationSchema).optional(),
  skills: z.array(SkillSchema).optional(),
  languages: z.array(LanguageSchema).optional(),
  interests: z.array(InterestSchema).optional(),
  references: z.array(ReferenceSchema).optional(),
  projects: z.array(ProjectSchema).optional(),
});

export type JsonResume = z.infer<typeof JsonResumeSchema>;
export type Basics = z.infer<typeof BasicsSchema>;
export type WorkEntry = z.infer<typeof WorkEntrySchema>;
export type VolunteerEntry = z.infer<typeof VolunteerEntrySchema>;
export type EducationEntry = z.infer<typeof EducationEntrySchema>;
export type Award = z.infer<typeof AwardSchema>;
export type Certificate = z.infer<typeof CertificateSchema>;
export type Publication = z.infer<typeof PublicationSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type Interest = z.infer<typeof InterestSchema>;
export type Reference = z.infer<typeof ReferenceSchema>;
export type Project = z.infer<typeof ProjectSchema>;
