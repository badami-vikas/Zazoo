import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const overlaySource = await readFile(new URL("../src/app/avatar/AvatarOverlay.tsx", import.meta.url), "utf8");

test("the in-app browser companion uses the shipped Zazoo renderer", () => {
  assert.match(overlaySource, /from ["']\.\/zazoo\/ZazooAvatar["']/);
  assert.match(overlaySource, /<ZazooAvatar\b/);
});
