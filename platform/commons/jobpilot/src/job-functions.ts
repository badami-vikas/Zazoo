// Onboarding step 2/3 (TASK-076: "select interested jobs. Then allow the user to
// rank order various job functions") — the canonical chip list both steps pick
// from. A fixed list, not a taxonomy service: JobPilot has no job-function
// ontology to derive this from yet, and inventing one would be speculative.
export const JOB_FUNCTIONS = [
  "Software Engineering",
  "Product Management",
  "Data Science",
  "Design",
  "Marketing",
  "Sales",
  "Operations",
  "Finance",
  "Consulting",
  "Customer Success",
  "Human Resources",
  "Legal",
] as const;

export type JobFunction = (typeof JOB_FUNCTIONS)[number];
