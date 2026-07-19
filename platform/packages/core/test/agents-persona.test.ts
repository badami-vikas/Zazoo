import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildChiefOfStaffPersona,
  profileFromRow,
  renderPersonaSystemPreamble,
  type OnboardingProfile,
  type OnboardingProfileRow,
} from "../src/index.js";

test("AGENTS-2: profile context changes framing without deriving a visual-style tone", () => {
  const a: OnboardingProfile = {
    organizationId: "w-a",
    source: "onboarding",
    role: "investor",
    goals: ["close the fund"],
  };
  const b: OnboardingProfile = {
    organizationId: "w-b",
    source: "onboarding",
    role: "recruiter",
    goals: ["fill three roles"],
  };
  const pa = buildChiefOfStaffPersona(a);
  const pb = buildChiefOfStaffPersona(b);
  assert.notEqual(pa.role, pb.role, "role framing should differ by profile");
  assert.equal(pa.tone, undefined);
  assert.equal(pb.tone, undefined);
  assert.match(pa.role, /investor/);
  assert.match(pb.role, /recruiter/);
});

test("AGENTS-2: a sparse profile produces a valid persona without a tone line", () => {
  const none = buildChiefOfStaffPersona({ organizationId: "w", source: "onboarding" });
  assert.equal(none.tone, undefined);
  assert.equal(none.name, "Chief of Staff");
  assert.ok((none.responsibilities?.length ?? 0) > 0);
  assert.match(none.role, /the person in this organization/);
});

test("AGENTS-2: rich profile framing carries role, goals, domains, and working style", () => {
  const persona = buildChiefOfStaffPersona({
    organizationId: "w",
    source: "onboarding",
    role: "solo founder",
    goals: ["ship v1", "raise a seed"],
    domains: ["fintech", "compliance"],
    workingStyleNotes: "prefers terse bullet summaries",
  });
  assert.match(persona.role, /solo founder/);
  assert.match(persona.role, /ship v1; raise a seed/);
  assert.match(persona.role, /fintech, compliance/);
  assert.match(persona.role, /terse bullet summaries/);
});

test("AGENTS-2: profileFromRow maps stored fields honestly and omits absent ones (no invented data)", () => {
  const row: OnboardingProfileRow = {
    organizationId: "w-1",
    avatarStyle: "turtle",
    answers: { role: "GP", goals: ["deploy capital"], domains: "venture", workingStyle: "  calm and unhurried  " },
    phoneVerified: true,
    verificationMethod: "phone",
    connectedSourceIds: ["gmail", "calendar"],
    updatedAtISO: "2026-07-14T00:00:00.000Z",
  };
  const profile = profileFromRow(row);
  assert.equal(profile.organizationId, "w-1");
  assert.equal(profile.source, "onboarding");
  assert.deepEqual(profile.connectedSources, ["gmail", "calendar"]);
  assert.equal(profile.role, "GP");
  assert.deepEqual(profile.goals, ["deploy capital"]);
  assert.deepEqual(profile.domains, ["venture"]);
  assert.equal(profile.workingStyleNotes, "calm and unhurried");

  const sparse = profileFromRow({
    organizationId: "w-2",
    avatarStyle: "",
    answers: {},
    phoneVerified: false,
    verificationMethod: null,
    connectedSourceIds: [],
    updatedAtISO: "2026-07-14T00:00:00.000Z",
  });
  assert.equal(sparse.connectedSources, undefined);
  assert.equal(sparse.role, undefined);
  assert.equal(sparse.goals, undefined);
});

test("AGENTS-2: the CoS persona projects through the shared seam without Avatar-derived tone", () => {
  const persona = buildChiefOfStaffPersona({ organizationId: "w", source: "onboarding", role: "operator" });
  const preamble = renderPersonaSystemPreamble(persona).join("\n");
  assert.match(preamble, /## Kernel invariants \(non-negotiable\)/);
  assert.match(preamble, /You are Chief of Staff\./);
  assert.doesNotMatch(preamble, /Match this tone in how you write/);
});
