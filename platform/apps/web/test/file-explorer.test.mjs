/**
 * The Files Section's folder derivation (ADR-195).
 *
 * `modules.files` returns a FLAT list of file paths relative to the Module root
 * — there are no directory entries. Every folder the explorer shows is inferred
 * from the separators in those paths, so this derivation is the whole navigation
 * model. These cases are the ones where a plausible implementation is quietly
 * wrong: prefix collisions, aggregation over nested files, and the folders-first
 * ordering every file manager has but a naive sort does not.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  entriesForFolder,
  formatBytes,
  sortEntries,
} from "../src/app/components/shared/file-explorer-model.ts";

const items = [
  { path: "TEST.txt", size: 100, modifiedAt: "2026-08-01T10:00:00.000Z" },
  { path: "Pictures/a.png", size: 2000, modifiedAt: "2026-08-03T10:00:00.000Z" },
  { path: "Pictures/b.png", size: 3000, modifiedAt: "2026-08-05T10:00:00.000Z" },
  { path: "Pictures/raw/c.png", size: 5000, modifiedAt: "2026-08-02T10:00:00.000Z" },
  { path: "test/notes.md", size: 50, modifiedAt: "2026-08-04T10:00:00.000Z" },
  { path: "test2/notes.md", size: 70, modifiedAt: "2026-08-06T10:00:00.000Z" },
];

const byName = (entries) => entries.map((e) => e.name);

test("the root lists top-level folders and files, and never a nested path", () => {
  const entries = entriesForFolder(items, "");
  assert.deepEqual(new Set(byName(entries)), new Set(["Pictures", "test", "test2", "TEST.txt"]));
  // The old UI showed "Pictures/raw/c.png" as a row at the root. It must not.
  assert.ok(!byName(entries).includes("Pictures/raw/c.png"));
  assert.ok(!byName(entries).includes("raw"), "a grandchild folder is not a root entry");
});

test("a folder aggregates size and newest timestamp over everything beneath it", () => {
  const pictures = entriesForFolder(items, "").find((e) => e.name === "Pictures");
  assert.equal(pictures.isDirectory, true);
  assert.equal(pictures.size, 2000 + 3000 + 5000, "includes the nested raw/c.png");
  assert.equal(pictures.childCount, 3);
  assert.equal(pictures.modifiedAt, "2026-08-05T10:00:00.000Z", "newest descendant wins");
});

test("descending into a folder shows its own children only", () => {
  const entries = entriesForFolder(items, "Pictures");
  assert.deepEqual(new Set(byName(entries)), new Set(["raw", "a.png", "b.png"]));
  const raw = entries.find((e) => e.name === "raw");
  assert.equal(raw.isDirectory, true);
  assert.equal(raw.path, "Pictures/raw", "path stays root-relative for the breadcrumb");
  assert.deepEqual(byName(entriesForFolder(items, "Pictures/raw")), ["c.png"]);
});

test("a folder name that prefixes another is not absorbed by it", () => {
  // "test" must not swallow "test2" — the separator, not the prefix, decides.
  assert.deepEqual(byName(entriesForFolder(items, "test")), ["notes.md"]);
  assert.deepEqual(byName(entriesForFolder(items, "test2")), ["notes.md"]);
  assert.equal(entriesForFolder(items, "test")[0].size, 50);
  assert.equal(entriesForFolder(items, "test2")[0].size, 70);
});

test("a file is never mistaken for a folder", () => {
  const txt = entriesForFolder(items, "").find((e) => e.name === "TEST.txt");
  assert.equal(txt.isDirectory, false);
  assert.equal(txt.childCount, undefined);
  assert.equal(txt.path, "TEST.txt");
});

test("an unknown folder yields nothing rather than throwing", () => {
  assert.deepEqual(entriesForFolder(items, "does/not/exist"), []);
  assert.deepEqual(entriesForFolder([], ""), []);
});

test("folders sort before files whatever the sort column is", () => {
  for (const key of ["name", "size", "modifiedAt"]) {
    for (const dir of ["asc", "desc"]) {
      const sorted = sortEntries(entriesForFolder(items, ""), key, dir);
      const firstFile = sorted.findIndex((e) => !e.isDirectory);
      const lastFolder = sorted.map((e) => e.isDirectory).lastIndexOf(true);
      assert.ok(lastFolder < firstFile, `${key}/${dir} interleaved a folder with a file`);
    }
  }
});

test("sorting is by the column asked for, in the direction asked for", () => {
  const inFolder = entriesForFolder(items, "Pictures").filter((e) => !e.isDirectory);
  assert.deepEqual(byName(sortEntries(inFolder, "size", "asc")), ["a.png", "b.png"]);
  assert.deepEqual(byName(sortEntries(inFolder, "size", "desc")), ["b.png", "a.png"]);
  assert.deepEqual(byName(sortEntries(inFolder, "modifiedAt", "desc")), ["b.png", "a.png"]);
  assert.deepEqual(byName(sortEntries(inFolder, "name", "desc")), ["b.png", "a.png"]);
});

test("name sort is case-insensitive and numeric-aware, not raw codepoint order", () => {
  const entries = [
    { name: "file10.txt", path: "file10.txt", isDirectory: false, size: 0, modifiedAt: "" },
    { name: "File2.txt", path: "File2.txt", isDirectory: false, size: 0, modifiedAt: "" },
    { name: "apple.txt", path: "apple.txt", isDirectory: false, size: 0, modifiedAt: "" },
  ];
  // Raw codepoint order would put every capital before every lowercase, and
  // "file10" before "File2".
  assert.deepEqual(byName(sortEntries(entries, "name", "asc")), [
    "apple.txt",
    "File2.txt",
    "file10.txt",
  ]);
});

test("sortEntries does not mutate its input", () => {
  const entries = entriesForFolder(items, "");
  const before = byName(entries);
  sortEntries(entries, "size", "desc");
  assert.deepEqual(byName(entries), before);
});

test("byte sizes read like a file manager, not like raw bytes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(999), "999 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 * 1024), "1 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024), "1 GB");
  // Above 10 the decimal is noise, so it is dropped.
  assert.equal(formatBytes(20 * 1024), "20 KB");
});
