# Recon — data directory

All files here are **analyst-local** and git-ignored. Never commit them.

| File | Purpose |
|---|---|
| `staging.jsonl` | Rows awaiting approval. Cleared on promote or discard. |
| `permanent.jsonl` | Analyst-approved facts. Append-only. |
| `flags.jsonl` | Inaccurate rows flagged by the analyst. Excluded from promotion. |
| `entity-links.jsonl` | Analyst entity-merge votes (GroupBy staging row IDs → one entityId). |
| `ofac-sdn.json` | Cached OFAC SDN list download. Refreshed automatically. |

## Row schema (`StoreRow`)

```ts
{
  id:                string;      // "reportId:rowIndex"
  reportId:          string;      // "identityId:ISO-timestamp"
  subjectName:       string;      // display name as searched
  subjectKey:        string;      // normalised (lowercase, alphanumeric+space)
  subjectKind:       string;      // "person" | "company" | "fund"
  scope:             string;      // "person" | "company" | "signal"
  label:             string;      // fact label, e.g. "Title", "LinkedIn (public snippet)"
  value:             string;      // fact value
  tier:              "A"|"B"|"C"; // A = decision-driving, B = context, C = color
  source:            string;      // canonical source name (see sourceConfidence map)
  url?:              string;      // primary evidence URL
  discoveredAt:      string;      // ISO timestamp
  eid:               string;      // entity ID — auto-heuristic; overridden by EntityLink votes
  confidence:        number;      // 0–1 source reliability score
  verificationState: "found"|"probable"|"verified"|"rejected";
}
```

## Verification state lifecycle

| State | Meaning |
|---|---|
| `found` | Single source reported this fact |
| `probable` | Tier A + confidence ≥ 0.80 (high-reliability source) |
| `verified` | Analyst-supplied (`source === "Analyst input"`) |
| `rejected` | Analyst flagged as inaccurate via the ⚑ button |
