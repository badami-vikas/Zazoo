// Shared card shape. (Rehomed from the now-deleted parse-card.ts, whose regex
// OCR parser was dead code — extraction is vision-LLM only.)

export interface CardData {
  name: string;
  role: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  additional: string;
}
