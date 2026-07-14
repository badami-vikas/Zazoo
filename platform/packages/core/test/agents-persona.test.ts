import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildChiefOfStaffPersona,
  resolveAnimalTone,
  profileFromRow,
  renderPersonaSystemPreamble,
  type OnboardingProfile,
  type OnboardingProfileRow,
} from "../src/index.js";

test("AGENTS-2: two different profiles produce two distinct Chief-of-Staff personas", () => {
  const a: OnboardingProfile = {
    workspaceId: "w-a",
    source: "onboarding",
    role: "investor",
    chosenAnimalId: "owl",
    goals: ["close the fund"],
  };
  const b: OnboardingProfile = {
    workspaceId: "w-b",
    source: "onboarding",
    role: "recruiter",
    chosenAnimalId: "fox",
    goals: ["fill three roles"],
  };
  const pa = buildChiefOfStaffPersona(a);
  const pb = buildChiefOfStaffPersona(b);
  assert.notEqual(pa.role, pb.role, "role framing should differ by profile");
  assert.notEqual(pa.tone, pb.tone, "tone should differ by chosen animal");
  assert.match(pa.role, /investor/);
  assert.match(pb.role, /recruiter/);
});

test("AGENTS-2: the chosen animal's tone is reflected in the persona", () => {
  const persona = buildChiefOfStaffPersona({ workspaceId: "w", source: "onboarding", chosenAnimalId: "owl" });
  assert.equal(persona.tone, resolveAnimalTone("owl"));
  assert.match(persona.tone ?? "", /wise and calm/);
});

test("AGENTS-2: an unknown or unset animal degrades gracefully (valid persona, no tone line)", () => {
  const unknown = buildChiefOfStaffPersona({ workspaceId: "w", source: "onboarding", chosenAnimalId: "griffin" });
  assert.equal(unknown.tone, undefined);
  assert.equal(unknown.name, "Chief of Staff");
  assert.ok((unknown.responsibilities?.length ?? 0) > 0);

  const none = buildChiefOfStaffPersona({ workspaceId: "w", source: "onboarding" });
  assert.equal(none.tone, undefined);
  assert.match(none.role, /the person in this workspace/);
});

test("AGENTS-2: resolveAnimalTone is case-insensitive and returns undefined for unknown/unset", () => {
  assert.equal(resolveAnimalTone("OWL"), resolveAnimalTone("owl"));
  assert.ok(resolveAnimalTone("Fox"));
  assert.equal(resolveAnimalTone("griffin"), undefined);
  assert.equal(resolveAnimalTone(undefined), undefined);
});

test("AGENTS-2: rich profile framing carries role, goals, domains, and working style", () => {
  const persona = buildChiefOfStaffPersona({
    workspaceId: "w",
    source: "onboarding",
    role: "solo founder",
    goals: ["ship v1", "raise a seed"],
    domains: ["fintech", "compliance"],
    workingStyleNotes: "prefers terse bullet summaries",
    chosenAnimalId: "eagle",
  });
  assert.match(persona.role, /solo founder/);
  assert.match(persona.role, /ship v1; raise a seed/);
  assert.match(persona.role, /fintech, compliance/);
  assert.match(persona.role, /terse bullet summaries/);
});

test("AGENTS-2: profileFromRow maps stored fields honestly and omits absent ones (no invented data)", () => {
  const row: OnboardingProfileRow = {
    workspaceId: "w-1",
    animal: "turtle",
    answers: { role: "GP", goals: ["deploy capital"], domains: "venture", workingStyle: "  calm and unhurried  " },
    phoneVerified: true,
    verificationMethod: "phone",
    connectedSourceIds: ["gmail", "calendar"],
    updatedAtISO: "2026-07-14T00:00:00.000Z",
  };
  const profile = profileFromRow(row);
  assert.equal(profile.workspaceId, "w-1");
  assert.equal(profile.source, "onboarding");
  assert.equal(profile.chosenAnimalId, "turtle");
  assert.deepEqual(profile.connectedSources, ["gmail", "calendar"]);
  assert.equal(profile.role, "GP");
  assert.deepEqual(profile.goals, ["deploy capital"]);
  assert.deepEqual(profile.domains, ["venture"]);
  assert.equal(profile.workingStyleNotes, "calm and unhurried");

  const sparse = profileFromRow({
    workspaceId: "w-2",
    animal: "",
    answers: {},
    phoneVerified: false,
    verificationMethod: null,
    connectedSourceIds: [],
    updatedAtISO: "2026-07-14T00:00:00.000Z",
  });
  assert.equal(sparse.chosenAnimalId, undefined);
  assert.equal(sparse.connectedSources, undefined);
  assert.equal(sparse.role, undefined);
  assert.equal(sparse.goals, undefined);
});

test("AGENTS-2: the CoS persona projects through the shared seam with kernel invariants + tone", () => {
  const persona = buildChiefOfStaffPersona({ workspaceId: "w", source: "onboarding", role: "operator", chosenAnimalId: "owl" });
  const preamble = renderPersonaSystemPreamble(persona).join("\n");
  assert.match(preamble, /## Kernel invariants \(non-negotiable\)/);
  assert.match(preamble, /You are Chief of Staff\./);
  assert.match(preamble, /Match this tone in how you write.*wise and calm/);
});
