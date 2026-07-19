import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const copy = JSON.parse(readFileSync(join(root, "src/copy.json"), "utf8"));
const website = readFileSync(join(root, "src/ZazooWebsite.tsx"), "utf8");
const opening = readFileSync(join(root, "src/scenes-opening.tsx"), "utf8");
const chapters = readFileSync(join(root, "src/scenes-chapters.tsx"), "utf8");
const closing = readFileSync(join(root, "src/scenes-closing.tsx"), "utf8");
const characters = readFileSync(join(root, "src/characters.tsx"), "utf8");
const styles = [
  "base.css",
  "characters.css",
  "opening.css",
  "chapters.css",
  "closing.css",
].map((file) => readFileSync(join(root, "src/styles", file), "utf8")).join("\n");

test("renders the ten storyboard scenes in playback order", () => {
  const scenes = [
    "HeroScene",
    "FamilyScene",
    "GovernanceScene",
    "LibraryScene",
    "ValuesScene",
    "ProcessScene",
    "DifferenceScene",
    "ImpactScene",
    "NightScene",
    "MorningScene",
  ];

  let previous = -1;
  for (const scene of scenes) {
    const position = website.indexOf(`<${scene} />`);
    assert.ok(position > previous, `${scene} must follow the preceding scene`);
    previous = position;
  }
});

test("keeps public copy within the approved storyboard", () => {
  const serialized = JSON.stringify(copy);
  const rejected = [
    "Origin",
    "Start free",
    "Tomorrow morning, yours could already be working",
    "Consulting",
    "Training",
  ];

  for (const phrase of rejected) {
    assert.equal(serialized.includes(phrase), false, `copy must not contain ${phrase}`);
  }

  assert.equal(
    copy.family.quote,
    "A Zazoo is an AI companion whose sole purpose is to create an asymmetrical leap in your capability, making you significantly effective without demanding extra effort.",
  );
  assert.equal(
    copy.family.linaIntroduction,
    "Hi. I'm Lina. I read, connect ideas, and bring back what deserves your attention.",
  );
  assert.equal("impactEvidence" in copy.impact, false);
});

test("provides pointer, keyboard, touch, and approval-boundary controls", () => {
  assert.match(opening, /<button[\s\S]*copy\.hero\.action/);
  assert.match(opening, /aria-expanded=\{selected === index\}/);
  assert.match(opening, /useEscape\(close/);
  assert.match(opening, /chapter-book/);
  assert.match(chapters, /onClick=\{continueJourney\}/);
  assert.match(closing, /aria-disabled="true"/);
});

test("ships responsive sticky scenes and reduced-motion fallbacks", () => {
  assert.match(styles, /\.scene__sticky\s*\{[\s\S]*position:\s*sticky/);
  assert.match(styles, /@media \(max-width:\s*720px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(chapters, /data-reduced-motion=\{reducedMotion\}/);
  assert.match(closing, /data-frame=\{reducedMotion \? reducedFrame : undefined\}/);
});

test("uses real buttons for every interactive family member and chapter", () => {
  assert.match(opening, /cast\.map\([\s\S]*<button/);
  assert.match(opening, /chapterTargets\.map\([\s\S]*<button/);
  assert.match(opening, /type="button"/);
});

test("uses the storyboard guardian species and inspectable notebook interaction", () => {
  assert.match(characters, /"dog"/);
  assert.match(characters, /"bear"/);
  assert.match(opening, /species="dog"[\s\S]*guardian--gatekeeper/);
  assert.match(opening, /species="bear"[\s\S]*guardian--auditor/);
  assert.match(chapters, /aria-expanded=\{notebookOpen\}/);
  assert.match(chapters, /useEscape\(\(\) => setNotebookOpen\(false\)/);
});
