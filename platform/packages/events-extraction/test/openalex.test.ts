import assert from "node:assert/strict";
import test from "node:test";
import { resolveOpenAlexAuthor } from "../src/openalex.js";

test("resolves the top result and surfaces orcid + affiliation", async () => {
  const match = await resolveOpenAlexAuthor("Ada Lovelace", undefined, async () => ({
    results: [
      {
        id: "https://openalex.org/A123",
        display_name: "Ada Lovelace",
        orcid: "https://orcid.org/0000-0000-0000-0001",
        last_known_institutions: [{ display_name: "Analytical Engines Ltd" }],
      },
    ],
  }));
  assert.deepEqual(match, {
    openAlexId: "https://openalex.org/A123",
    displayName: "Ada Lovelace",
    orcid: "https://orcid.org/0000-0000-0000-0001",
    affiliation: "Analytical Engines Ltd",
  });
});

test("prefers the result whose institution matches the supplied affiliation over the top hit", async () => {
  const match = await resolveOpenAlexAuthor("Jane Doe", "Beta Institute", async () => ({
    results: [
      { id: "https://openalex.org/A1", display_name: "Jane Doe", last_known_institutions: [{ display_name: "Acme University" }] },
      { id: "https://openalex.org/A2", display_name: "Jane Doe", last_known_institutions: [{ display_name: "Beta Institute" }] },
    ],
  }));
  assert.equal(match?.openAlexId, "https://openalex.org/A2");
});

test("returns null on empty results", async () => {
  const match = await resolveOpenAlexAuthor("Nobody Real", undefined, async () => ({ results: [] }));
  assert.equal(match, null);
});

test("returns null when fetchJson throws — best-effort, never blocks the draft", async () => {
  const match = await resolveOpenAlexAuthor("Jane Doe", undefined, async () => {
    throw new Error("network down");
  });
  assert.equal(match, null);
});

test("returns null for a blank name without calling fetchJson", async () => {
  let called = false;
  const match = await resolveOpenAlexAuthor("   ", undefined, async () => {
    called = true;
    return { results: [] };
  });
  assert.equal(match, null);
  assert.equal(called, false);
});
