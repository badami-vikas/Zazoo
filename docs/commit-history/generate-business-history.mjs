#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const outputDir = here;

function git(args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function sentence(value) {
  const cleaned = value.trim().replace(/[.]+$/, "");
  return cleaned ? `${cleaned[0].toUpperCase()}${cleaned.slice(1)}.` : "";
}

function readableSubject(subject) {
  return subject
    .replace(/^Merge pull request #(\d+) from .+$/i, "approved pull request #$1")
    .replace(/^Merge branch ['"]?([^'"]+)['"]?.*$/i, "work from branch $1")
    .replace(/^(feat|fix|docs|test|refactor|chore|build|ci|perf|style|revert)(\([^)]+\))?!?:\s*/i, "")
    .replace(/[_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classify(subject, parents) {
  if (parents.trim().split(/\s+/).filter(Boolean).length > 1 || /^merge\b/i.test(subject)) {
    return "Integration";
  }
  const prefix = subject.match(/^([a-z]+)(?:\([^)]+\))?!?:/i)?.[1]?.toLowerCase();
  const labels = {
    feat: "Product capability",
    fix: "Correction",
    docs: "Documentation and decision",
    test: "Quality assurance",
    refactor: "Internal simplification",
    chore: "Maintenance",
    build: "Build and delivery",
    ci: "Build and delivery",
    perf: "Performance",
    style: "Presentation",
    revert: "Rollback",
  };
  return labels[prefix] ?? "Product progress";
}

function businessSummary(subject, parents, classification, areas) {
  const plain = readableSubject(subject);
  const parentCount = parents.trim().split(/\s+/).filter(Boolean).length;
  if (parentCount > 1 || /^merge\b/i.test(subject)) {
    return sentence(`Combined ${plain} into the shared product so the team could continue from one agreed version`);
  }

  const areaText = areas.length ? areas.slice(0, 3).join(", ") : "the product";
  const lead = {
    "Product capability": `Expanded ${areaText} so Bridge could do more useful work`,
    Correction: `Fixed a problem affecting ${areaText}, improving reliability and trust`,
    "Documentation and decision": `Clarified the plan, decision record, or delivery evidence for ${areaText}`,
    "Quality assurance": `Strengthened checks around ${areaText} to reduce release risk`,
    "Internal simplification": `Simplified ${areaText} so future changes are easier and safer`,
    Maintenance: `Maintained ${areaText} and reduced operational friction`,
    "Build and delivery": `Improved how ${areaText} is built, checked, or released`,
    Performance: `Made ${areaText} faster or more efficient`,
    Presentation: `Refined how ${areaText} looks or reads`,
    Rollback: `Reversed an earlier change in ${areaText} to restore the intended behavior`,
    "Product progress": `Advanced ${areaText}`,
  }[classification] ?? `Advanced ${areaText}`;
  return `${sentence(lead)} Focus: ${sentence(plain)}`;
}

function areaForPath(path) {
  const rules = [
    [/^platform\/apps\/desktop\//, "Desktop and Avatar"],
    [/^platform\/apps\/mobile\//, "Mobile experience"],
    [/^platform\/apps\/web\//, "Web experience"],
    [/^platform\/apps\/api\//, "API and hosted services"],
    [/^platform\/services\/commons\//, "Commons"],
    [/^platform\/modules\/dealpilot\//, "DealPilot"],
    [/^platform\/modules\/jobpilot\//, "JobPilot"],
    [/^platform\/modules\//, "Modules"],
    [/^platform\/packages\/core\//, "Engine and governance"],
    [/^platform\/packages\/db\//, "Data and storage"],
    [/^platform\/packages\/local\//, "Local Plane"],
    [/^platform\/packages\/models\//, "AI model routing"],
    [/^platform\/packages\/integrations/, "Integrations"],
    [/^platform\/packages\/sensors\//, "Sensing and capture"],
    [/^platform\//, "Platform foundation"],
    [/^docs\//, "Strategy and documentation"],
    [/^outputs\//, "Delivery evidence"],
    [/^render\.yaml$|Dockerfile|\.github\//, "Deployment and operations"],
    [/^recon\//i, "Relationship research"],
    [/extension/i, "Browser companion"],
  ];
  return rules.find(([pattern]) => pattern.test(path))?.[1] ?? "Repository operations";
}

const recordSeparator = "\x1e";
const fieldSeparator = "\x1f";
const log = git([
  "log",
  "--all",
  "--reverse",
  "--topo-order",
  `--pretty=format:${recordSeparator}%H${fieldSeparator}%ad${fieldSeparator}%an${fieldSeparator}%s${fieldSeparator}%b${fieldSeparator}%P`,
  "--date=short",
]);

const headCommits = new Set(git(["rev-list", "HEAD"]).split("\n").filter(Boolean));
const commits = log
  .split(recordSeparator)
  .filter(Boolean)
  .map((record) => {
    const [hash, date, author, subject, body, parents] = record.split(fieldSeparator);
    const paths = git(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", hash])
      .split("\n")
      .filter(Boolean);
    const areas = [...new Set(paths.map(areaForPath))].slice(0, 5);
    const classification = classify(subject, parents);
    return {
      hash,
      shortHash: hash.slice(0, 8),
      date,
      month: date.slice(0, 7),
      author,
      subject,
      body,
      parents,
      paths,
      areas,
      classification,
      summary: businessSummary(subject, parents, classification, areas),
      onHead: headCommits.has(hash),
    };
  });

const byMonth = new Map();
for (const commit of commits) {
  const list = byMonth.get(commit.month) ?? [];
  list.push(commit);
  byMonth.set(commit.month, list);
}

mkdirSync(outputDir, { recursive: true });
for (const [month, monthCommits] of byMonth) {
  const lines = [
    `# ${month} — business-language commit history`,
    "",
    `Every repository commit visible from all local refs is listed once. ${monthCommits.length} commits in this file.`,
    "",
    "“Current” means the commit is an ancestor of the checked-out product state. “Other ref” means it is preserved on another local branch or archive ref and may represent superseded, parallel, or unmerged work.",
    "",
  ];

  for (const commit of monthCommits) {
    lines.push(
      `## ${commit.date} · \`${commit.shortHash}\` · ${commit.classification}`,
      "",
      commit.summary,
      "",
      `- Original commit title: ${commit.subject}`,
      `- Business areas: ${commit.areas.length ? commit.areas.join(", ") : "Repository operations"}`,
      `- Product-history status: ${commit.onHead ? "Current product lineage" : "Preserved on another ref"}`,
      `- Author: ${commit.author}`,
      `- Files affected: ${commit.paths.length}`,
      "",
    );
  }

  writeFileSync(join(outputDir, `${month}.md`), `${lines.join("\n")}\n`);
}

const currentCount = commits.filter((commit) => commit.onHead).length;
const indexLines = [
  "# Commit history — business edition",
  "",
  "This archive translates the repository’s complete visible git history into simple business language. It explains what changed and which part of the business or product it affected; it does not replace git as the engineering audit record.",
  "",
  "## Coverage",
  "",
  `- ${commits.length} unique commits visible from all local refs`,
  `- ${currentCount} commits in the checked-out product lineage`,
  `- ${commits.length - currentCount} commits preserved on other branches or archive refs`,
  `- ${byMonth.size} monthly files`,
  "",
  "## History files",
  "",
  "| Month | Commits | Current lineage | Other refs | File |",
  "|---|---:|---:|---:|---|",
];

for (const [month, monthCommits] of byMonth) {
  const current = monthCommits.filter((commit) => commit.onHead).length;
  indexLines.push(
    `| ${escapeTable(month)} | ${monthCommits.length} | ${current} | ${monthCommits.length - current} | [Open](./${month}.md) |`,
  );
}

indexLines.push(
  "",
  "## How to read this",
  "",
  "- Start with the monthly files for the chronological story.",
  "- Use the short hash to find the exact engineering record with `git show <hash>`.",
  "- Treat merge commits as integration milestones; the underlying commits carry the detailed work.",
  "- “Preserved on another ref” is not automatically discarded work. It may be an archive checkpoint, a parallel branch, or superseded work retained for audit.",
  "",
  "## Regeneration",
  "",
  "Run `node docs/commit-history/generate-business-history.mjs` from anywhere inside this repository. The generator reads local refs only and makes no network calls.",
  "",
);

writeFileSync(join(outputDir, "README.md"), `${indexLines.join("\n")}\n`);
console.log(`Wrote ${commits.length} commit entries across ${byMonth.size} monthly files.`);
