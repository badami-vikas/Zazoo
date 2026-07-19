import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const copy = JSON.parse(readFileSync(join(root, "src/alternative-home/copy.json"), "utf8"));
const home = readFileSync(join(root, "src/alternative-home/AlternativeHome.tsx"), "utf8");
const shifts = readFileSync(join(root, "src/alternative-home/section-shifts.tsx"), "utf8");
const organization = readFileSync(join(root, "src/alternative-home/section-organization.tsx"), "utf8");
const infrastructure = readFileSync(join(root, "src/alternative-home/section-infrastructure.tsx"), "utf8");
const journey = readFileSync(join(root, "src/alternative-home/section-journey.tsx"), "utf8");
const evidence = readFileSync(join(root, "src/alternative-home/evidence.ts"), "utf8");
const library = readFileSync(join(root, "alternative-home/case-study-library.md"), "utf8");
const viteConfig = readFileSync(join(root, "vite.config.ts"), "utf8");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");
const website = readFileSync(join(root, "src/ZazooWebsite.tsx"), "utf8");
const styles = [
  "alt-shared.css",
  "shifts.css",
  "organization.css",
  "infrastructure.css",
  "journey.css",
].map((file) => readFileSync(join(root, "src/alternative-home/styles", file), "utf8")).join("\n");

test("registers the isolated entry without touching the original homepage", () => {
  assert.match(viteConfig, /alternative-home\.html/);
  assert.equal(indexHtml.includes("alternative-home"), false);
  assert.equal(website.includes("alternative-home"), false);
  assert.equal(website.includes("AlternativeHome"), false);
});

test("renders the four narrative sections in documentary order", () => {
  const scenes = ["ShiftsScene", "OrganizationScene", "InfrastructureScene", "JourneyScene"];
  let previous = -1;
  for (const scene of scenes) {
    const position = home.indexOf(`<${scene} />`);
    assert.ok(position > previous, `${scene} must follow the preceding scene`);
    previous = position;
  }
});

test("keeps the approved copy exact", () => {
  assert.equal(copy.shifts.heading, "History doesn't repeat. Patterns do.");
  assert.equal(
    copy.shifts.reflection,
    "When history looks back at the AI era, where will your organization stand?",
  );
  assert.equal(copy.shifts.bookHref, "https://zazoo.me/consulting.html#cta");
  assert.deepEqual(copy.shifts.columns, ["Transitional Thinking", "Transformational Thinking"]);
  assert.equal(
    copy.shifts.bottomObservation,
    "Technology changes what's possible. Transformation changes who leads.",
  );
  assert.equal(
    copy.organization.heading,
    "AI-native organizations don't use AI. They are designed around it.",
  );
  assert.equal(copy.infrastructure.task, "Prepare the board presentation.");
  assert.equal(copy.infrastructure.questions.length, 6);
  assert.equal(copy.journey.heading, "Managing Intelligence");
  assert.equal(copy.journey.stages.length, 5);
  assert.equal(copy.journey.lenses.length, 4);
});

test("era selector, era evidence, and expansion behave per the brief", () => {
  assert.match(shifts, /"steam", "electricity", "computing", "internet", "ai"/);
  assert.match(shifts, /aria-pressed=\{!inHero && currentEra === id\}/);
  assert.match(shifts, /copy\.shifts\.more/);
  assert.match(evidence, /Barnes & Noble/);
  assert.match(evidence, /Blockbuster/);
  assert.match(evidence, /Kodak/);
  assert.match(shifts, /aria-disabled="true"/);
});

test("every page evidence fragment is quoted and marked Used on page in the library", () => {
  const fragments = [...evidence.matchAll(/^\s+"(.+)",?$/gm)]
    .map((match) => match[1])
    .filter((line) => !/^(steam|electricity|computing|internet|ai)$/.test(line));
  assert.ok(fragments.length >= 10, "expected the evidence module to carry page fragments");
  for (const fragment of fragments) {
    assert.ok(library.includes(fragment), `library must quote verbatim: ${fragment}`);
    const marked = library
      .split("\n")
      .some((line) => line.includes(fragment) && line.includes("Used on page"));
    assert.ok(marked, `library must mark as Used on page: ${fragment}`);
  }
});

test("interactions work by pointer, keyboard, and touch through real buttons", () => {
  assert.match(shifts, /type="button"/);
  assert.match(organization, /aria-pressed=\{stage >= index \+ 1\}/);
  assert.match(organization, /copy\.organization\.compare/);
  assert.match(infrastructure, /aria-pressed=\{activeQuestion === index\}/);
  assert.match(journey, /ArrowRight/);
  assert.match(journey, /aria-expanded=\{stage === index\}/);
  assert.match(journey, /aria-pressed=\{lens === index\}/);
});

test("ships sticky scenes, mobile compositions, and reduced-motion stills", () => {
  assert.match(styles, /@media \(max-width:\s*720px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(organization, /data-reduced-motion=\{reducedMotion\}/);
  assert.match(styles, /\.scene\[data-active="false"\]/);
});
