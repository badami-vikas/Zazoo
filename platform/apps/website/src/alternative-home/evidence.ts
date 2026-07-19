export type EraId = "steam" | "electricity" | "computing" | "internet" | "ai";

export interface EvidenceSide {
  org: string;
  fragments: string[];
}

export interface EvidencePair {
  id: string;
  transitional: EvidenceSide;
  transformational: EvidenceSide;
}

export interface EraEvidence {
  base: EvidencePair[];
  extended: EvidencePair[];
}

// Every organization name and fragment below is quoted verbatim and marked
// "Used on page" in alternative-home/case-study-library.md beside its source.
export const eraEvidence: Record<Exclude<EraId, "ai">, EraEvidence> = {
  steam: {
    base: [
      {
        id: "transport",
        transitional: {
          org: "Canal operators",
          fragments: ["The Erie Canal was enlarged for 25 years as railroads overtook it"],
        },
        transformational: {
          org: "Liverpool & Manchester Railway",
          fragments: [
            "It was the first fully timetabled railway carrying passengers and freight",
            "All trains were run by the company that owned the track",
          ],
        },
      },
    ],
    extended: [],
  },
  electricity: {
    base: [
      {
        id: "manufacturing",
        transitional: {
          org: "Group-drive factories",
          fragments: [
            "Between 1880 and 1930 factories moved from shaft-and-belt drive to individual electric motors",
            "The productivity gain arrived with factory redesign, not the motor itself",
          ],
        },
        transformational: {
          org: "Ford Highland Park",
          fragments: [
            "Ford's moving assembly line first ran at Highland Park in October 1913",
            "Model T output went from hundreds a day to thousands a day",
            "The Model T's price fell from $850 toward $260",
          ],
        },
      },
    ],
    extended: [],
  },
  computing: {
    base: [
      {
        id: "reservations",
        transitional: {
          org: "Manual reservation desks",
          fragments: ["Before SABRE, one airline reservation took about 90 minutes to process"],
        },
        transformational: {
          org: "American Airlines SABRE",
          fragments: [
            "By the mid-1960s SABRE handled 7,500 reservations an hour",
            "Completed in 1964, SABRE was the largest civil real-time computing system",
          ],
        },
      },
    ],
    extended: [],
  },
  internet: {
    base: [
      {
        id: "commerce",
        transitional: {
          org: "Barnes & Noble",
          fragments: [
            "Barnes & Noble ran over 1,000 bookstores in 1998",
            "Barnes & Noble launched BN.com in May 1997, months after Amazon's IPO filing",
          ],
        },
        transformational: {
          org: "Amazon",
          fragments: [
            "Amazon's 1997 S-1 called it 'the leading online retailer of books'",
            "Amazon's daily site visits grew from 2,200 to 80,000 in fifteen months",
          ],
        },
      },
      {
        id: "entertainment",
        transitional: {
          org: "Blockbuster",
          fragments: [
            "Blockbuster operated roughly 9,000 stores at its 2004 peak",
            "Blockbuster passed on buying Netflix for $50 million in 2000",
            "Blockbuster filed for Chapter 11 in September 2010",
          ],
        },
        transformational: {
          org: "Netflix",
          fragments: ["Netflix shipped DVDs by mail before streaming existed"],
        },
      },
      {
        id: "photography",
        transitional: {
          org: "Kodak",
          fragments: [
            "A Kodak engineer built the first portable digital camera in 1975",
            "Kodak executives: no one would want pictures on a television set",
            "Kodak filed for Chapter 11 in January 2012",
          ],
        },
        transformational: {
          org: "Instagram",
          fragments: ["Instagram had 13 employees when Facebook agreed to pay ~$1 billion"],
        },
      },
    ],
    extended: [
      {
        id: "reference",
        transitional: {
          org: "Encyclopaedia Britannica",
          fragments: [
            "Britannica print sales peaked at 120,000 sets in 1990",
            "Britannica ended its 32-volume print edition in 2012, after 244 years",
          ],
        },
        transformational: {
          org: "Wikipedia",
          fragments: ["Wikipedia launched in 2001 and passed one million articles by 2006"],
        },
      },
      {
        id: "classifieds",
        transitional: {
          org: "Classified-ad newspapers",
          fragments: [
            "US newspaper classified revenue peaked at $19.6 billion in 2000",
            "Classifieds were about 40% of newspaper ad revenue in 2000",
          ],
        },
        transformational: {
          org: "Craigslist",
          fragments: [
            "Craigslist began in 1995 as a San Francisco email list",
            "Craigslist's entry saved classified-ad buyers an estimated $5 billion (2000–2007)",
          ],
        },
      },
    ],
  },
};
