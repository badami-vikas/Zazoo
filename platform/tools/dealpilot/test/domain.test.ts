import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryDealPilotStore,
  SourceDiscoveryGateError,
  applyThesisSourceDiscovery,
  assertSourceDiscoveryAllowed,
  dealPilotModuleManifest,
  proposeThesisSourceDiscovery,
} from "../src/domain.js";

function store() {
  let id = 0;
  return new InMemoryDealPilotStore({
    now: () => "2026-07-16T00:00:00.000Z",
    id: (prefix) => `test_fixture_${prefix}_${++id}`,
  });
}

test("module manifest exposes only Deals, Sources, and Theses with conditional relation columns", () => {
  const withoutRelationship = dealPilotModuleManifest({
    relationshipAuthorized: false,
    tasksAuthorized: true,
  });
  assert.deepEqual(withoutRelationship.pages.map((page) => page.name), ["Deals", "Sources", "Theses"]);
  assert.ok(withoutRelationship.pages.every((page) => page.columns.some((column) => column.id === "tasks")));
  assert.ok(withoutRelationship.pages.every((page) => !page.columns.some((column) => column.id === "relationships")));

  const withRelationship = dealPilotModuleManifest({
    relationshipAuthorized: true,
    tasksAuthorized: true,
  });
  assert.ok(withRelationship.pages.every((page) => page.columns.some((column) => column.id === "relationships")));
});

test("Deal, Source, and Thesis form a symmetric many-to-many cluster", async () => {
  const records = store();
  const deal = await records.createDeal({
    workspaceId: "test_fixture_workspace",
    company: "test_fixture_company",
  });
  const source = await records.createSource({
    workspaceId: "test_fixture_workspace",
    name: "test_fixture_source",
    link: "https://example.invalid/source",
    connectionType: "url",
    spendCap: 10,
    rightsState: "attested",
    rightsAttestedBy: "test_fixture_human",
  });
  const thesis = await records.createThesis({
    workspaceId: "test_fixture_workspace",
    name: "test_fixture_thesis",
    focus: "test_fixture_focus",
  });

  await records.link({
    workspaceId: "test_fixture_workspace",
    kind: "deal_source",
    fromId: deal.id,
    toId: source.id,
    confidence: 1,
    provenance: "test_fixture_manual",
  });
  await records.link({
    workspaceId: "test_fixture_workspace",
    kind: "deal_thesis",
    fromId: deal.id,
    toId: thesis.id,
    confidence: 1,
    provenance: "test_fixture_manual",
  });
  await records.link({
    workspaceId: "test_fixture_workspace",
    kind: "source_thesis",
    fromId: source.id,
    toId: thesis.id,
    confidence: 1,
    provenance: "test_fixture_manual",
  });

  const [dealDetail, sourceDetail, thesisDetail] = await Promise.all([
    records.detail("deal", "test_fixture_workspace", deal.id, {
      relationshipAuthorized: false,
      tasksAuthorized: true,
    }),
    records.detail("source", "test_fixture_workspace", source.id, {
      relationshipAuthorized: false,
      tasksAuthorized: true,
    }),
    records.detail("thesis", "test_fixture_workspace", thesis.id, {
      relationshipAuthorized: false,
      tasksAuthorized: true,
    }),
  ]);

  assert.equal(dealDetail?.relations.length, 2);
  assert.equal(sourceDetail?.relations.length, 2);
  assert.equal(thesisDetail?.relations.length, 2);
  assert.deepEqual(new Set(dealDetail?.relatedRecords.map((record) => record.kind)), new Set(["source", "thesis"]));
});

test("Source discovery fails closed until rights and spend gates pass", async () => {
  const records = store();
  const source = await records.createSource({
    workspaceId: "test_fixture_workspace",
    name: "test_fixture_source",
    link: "https://example.invalid/source",
    connectionType: "account",
    spendCap: 5,
    rightsState: "unattested",
  });
  assert.throws(() => assertSourceDiscoveryAllowed(source, 1), (error: unknown) => {
    assert.ok(error instanceof SourceDiscoveryGateError);
    assert.equal(error.code, "rights_required");
    return true;
  });

  const attested = await records.updateSource(source.id, source.workspaceId, {
    rightsState: "attested",
    rightsAttestedAt: "2026-07-16T00:00:00.000Z",
    rightsAttestedBy: "test_fixture_human",
    spendToDate: 5,
  });
  assert.throws(() => assertSourceDiscoveryAllowed(attested, 1), (error: unknown) => {
    assert.ok(error instanceof SourceDiscoveryGateError);
    assert.equal(error.code, "spend_cap_exceeded");
    return true;
  });
});

test("Thesis discovery proposes only authorized Sources and materializes links after approval", async () => {
  const records = store();
  const thesis = await records.createThesis({
    workspaceId: "test_fixture_workspace",
    name: "test_fixture_thesis",
    focus: "test_fixture_focus",
  });
  const authorized = await records.createSource({
    workspaceId: "test_fixture_workspace",
    name: "test_fixture_authorized_source",
    link: "https://example.invalid/authorized",
    connectionType: "url",
    spendCap: 0,
    rightsState: "attested",
    rightsAttestedBy: "test_fixture_human",
  });
  await records.createSource({
    workspaceId: "test_fixture_workspace",
    name: "test_fixture_unattested_source",
    link: "https://example.invalid/unattested",
    connectionType: "url",
    spendCap: 0,
    rightsState: "unattested",
  });

  const proposal = await proposeThesisSourceDiscovery(records, thesis.workspaceId, thesis.id);
  assert.deepEqual(proposal.relations.map((relation) => relation.sourceId), [authorized.id]);
  assert.equal((await records.relations(thesis.workspaceId, thesis.id)).length, 0);

  const applied = await applyThesisSourceDiscovery(records, proposal);
  assert.equal(applied.length, 1);
  assert.equal((await records.relations(thesis.workspaceId, thesis.id)).length, 1);
});
