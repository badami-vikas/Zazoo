import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cultureResearchStorageKey,
  loadStoredCultureResearchState,
  saveStoredCultureResearchState,
  clearStoredCultureResearchState,
  deriveFullArtifactFactClaim,
} from './culture-research-client.ts';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

test('cultureResearchStorageKey is scoped by BOTH workspaceId and company', () => {
  const a = cultureResearchStorageKey('ws-1', 'Acme');
  const b = cultureResearchStorageKey('ws-2', 'Acme');
  const c = cultureResearchStorageKey('ws-1', 'Other Co');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('loadStoredCultureResearchState returns null when nothing is stored', () => {
  const storage = fakeStorage();
  assert.equal(loadStoredCultureResearchState(storage, 'ws-1', 'Acme'), null);
});

test('save/load round-trips the pointer state exactly', () => {
  const storage = fakeStorage();
  const state = {
    parentRunId: 'run-1',
    pending: [{ proposalId: 'p1', childRunId: 'c1', sourceId: 's1', sourceType: 'company_official_page', sourceLabel: 'Acme Careers' }],
    synthesisProposalId: 'synth-1',
  };
  saveStoredCultureResearchState(storage, 'ws-1', 'Acme', state);
  assert.deepEqual(loadStoredCultureResearchState(storage, 'ws-1', 'Acme'), state);
});

test('loadStoredCultureResearchState treats corrupt/foreign JSON as "nothing stored", never throws', () => {
  const storage = fakeStorage();
  storage.setItem(cultureResearchStorageKey('ws-1', 'Acme'), 'not json at all {{{');
  assert.equal(loadStoredCultureResearchState(storage, 'ws-1', 'Acme'), null);

  storage.setItem(cultureResearchStorageKey('ws-1', 'Acme'), JSON.stringify({ unrelated: true }));
  assert.equal(loadStoredCultureResearchState(storage, 'ws-1', 'Acme'), null);
});

test('clearStoredCultureResearchState removes only the matching (workspaceId, company) pointer', () => {
  const storage = fakeStorage();
  const state = { parentRunId: 'run-1', pending: [] };
  saveStoredCultureResearchState(storage, 'ws-1', 'Acme', state);
  saveStoredCultureResearchState(storage, 'ws-1', 'Other Co', state);
  clearStoredCultureResearchState(storage, 'ws-1', 'Acme');
  assert.equal(loadStoredCultureResearchState(storage, 'ws-1', 'Acme'), null);
  assert.deepEqual(loadStoredCultureResearchState(storage, 'ws-1', 'Other Co'), state);
});

test('deriveFullArtifactFactClaim forwards the REAL fetched content verbatim as the quote — never fabricates or paraphrases', () => {
  const artifact = { content: 'Our culture is built on trust and collaboration.', contentHash: 'abc123' };
  const claim = deriveFullArtifactFactClaim('claim-1', 'source-1', artifact);
  assert.equal(claim.claimType, 'fact');
  assert.equal(claim.sourceId, 'source-1');
  assert.equal(claim.quote, artifact.content);
  assert.equal(claim.contentHash, artifact.contentHash);
  // The quote must be an EXACT substring of the artifact content (trivially
  // true here since it IS the content) — this is what makes the server's
  // groundClaims check always succeed for a claim built this way.
  assert.ok(artifact.content.includes(claim.quote));
});
