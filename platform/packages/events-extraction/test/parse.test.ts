import assert from "node:assert/strict";
import test from "node:test";
import { extractSpeakerCandidates } from "../src/parse.js";

test("extracts Person entries from JSON-LD, ignoring non-Person nodes", () => {
  const html = `
    <html><head>
    <script type="application/ld+json">
    {
      "@type": "Event",
      "name": "DevConf 2026",
      "performer": [
        { "@type": "Person", "name": "Ada Lovelace", "affiliation": { "name": "Analytical Engines Ltd" } },
        { "@type": "Person", "name": "Grace Hopper" }
      ]
    }
    </script>
    </head><body>irrelevant prose</body></html>
  `;
  const speakers = extractSpeakerCandidates(html);
  assert.deepEqual(speakers, [
    { name: "Ada Lovelace", affiliation: "Analytical Engines Ltd" },
    { name: "Grace Hopper" },
  ]);
});

test("falls back to text heuristic when no JSON-LD is present", () => {
  const html = `
    <html><body>
      <p>Welcome to the conference.</p>
      <div>Jane Doe — Acme University</div>
      <div>John Smith, Beta Institute</div>
      <p>This is just a sentence about speakers in general.</p>
    </body></html>
  `;
  const speakers = extractSpeakerCandidates(html);
  assert.deepEqual(speakers, [
    { name: "Jane Doe", affiliation: "Acme University" },
    { name: "John Smith", affiliation: "Beta Institute" },
  ]);
});

test("malformed JSON-LD block is skipped, not thrown", () => {
  const html = `<script type="application/ld+json">{ not json </script><body>No speakers here.</body>`;
  assert.deepEqual(extractSpeakerCandidates(html), []);
});

test("deduplicates repeated text-heuristic rows", () => {
  const html = `
    <div>Jane Doe — Acme University</div>
    <div>Jane Doe — Acme University</div>
  `;
  assert.deepEqual(extractSpeakerCandidates(html), [{ name: "Jane Doe", affiliation: "Acme University" }]);
});

test("empty page yields no candidates", () => {
  assert.deepEqual(extractSpeakerCandidates("<html><body></body></html>"), []);
});
