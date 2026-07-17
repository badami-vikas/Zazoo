import test from 'node:test';
import assert from 'node:assert/strict';

import { BCG_APPLICATION } from './bcg-application.ts';

test('BCG application workspace contains the complete governed artifact set', () => {
  assert.equal(BCG_APPLICATION.company, 'Boston Consulting Group');
  assert.equal(BCG_APPLICATION.role, 'Consultant — MBA');
  assert.equal(BCG_APPLICATION.submission.requiresHumanApproval, true);

  const artifactIds = new Set(BCG_APPLICATION.artifacts.map((artifact) => artifact.id));
  for (const required of [
    'resume',
    'cover-letter',
    'application-answers',
    'networking',
    'behavioral-stories',
    'case-prep',
    'interviewer-questions',
    'submission-checklist',
  ]) {
    assert.ok(artifactIds.has(required), `missing ${required}`);
  }
});

test('every application claim is traceable and unresolved evidence stays visible', () => {
  assert.ok(BCG_APPLICATION.evidence.length >= 8);
  assert.ok(BCG_APPLICATION.evidence.every((claim) => claim.source && claim.status));
  assert.ok(BCG_APPLICATION.evidence.some((claim) => claim.status === 'needs-review'));
  assert.ok(BCG_APPLICATION.artifacts.every((artifact) => artifact.ownerAgent && artifact.skill));
});

test('interview preparation reflects BCG official evaluation dimensions', () => {
  const dimensions = new Set(BCG_APPLICATION.fit.dimensions.map((item) => item.label));
  for (const dimension of ['Integrity', 'Intellectual curiosity', 'Creative thinking', 'Collaborative mindset', 'Drive']) {
    assert.ok(dimensions.has(dimension), `missing ${dimension}`);
  }

  const casePrep = BCG_APPLICATION.artifacts.find((artifact) => artifact.id === 'case-prep');
  assert.ok(casePrep.sections.some((section) => section.body.includes('structure')));
  assert.ok(casePrep.sections.some((section) => section.body.includes('calculation')));
});

test('JP3B culture research: every claim carries a citation, a retrieval date, and a valid claimType', () => {
  const research = BCG_APPLICATION.cultureResearch;
  assert.ok(research.claims.length > 0);
  const validTypes = new Set(['fact', 'opinion', 'theme', 'contradiction', 'inference']);
  for (const claim of research.claims) {
    assert.ok(validTypes.has(claim.claimType), `invalid claimType on ${claim.id}`);
    assert.ok(claim.sourceUrl.startsWith('https://'), `${claim.id} must cite a real source URL`);
    assert.ok(claim.sourceLabel.length > 0, `${claim.id} must carry a source label`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(claim.retrievedAt), `${claim.id} must carry an ISO retrieval date`);
    // Never present an inference as anything but an inference, and never mark a
    // non-inference claim as agent-authored (mirrors @bridge/jobpilot's
    // partitionCultureEvidence invariant).
    assert.equal(claim.agentInference, claim.claimType === 'inference');
  }
});

test('JP3B culture research: contradictions stay an honest empty result, never a fabricated row', () => {
  assert.deepEqual(BCG_APPLICATION.cultureResearch.contradictions, []);
});

test('JP3B culture research: Reddit, Google reviews, and Glassdoor are explicitly skipped with real reasons — never silently absent', () => {
  const research = BCG_APPLICATION.cultureResearch;
  const skippedTypes = new Set(research.skippedSources.map((s) => s.sourceType));
  for (const required of ['reddit', 'google_reviews', 'glassdoor']) {
    assert.ok(skippedTypes.has(required), `${required} must be explicitly listed as skipped`);
  }
  for (const skipped of research.skippedSources) {
    assert.ok(skipped.reason.length > 20, `${skipped.sourceLabel} needs a real, substantive reason`);
  }
  // No claim may cite a skipped source type — only permitted sources produce claims.
  const claimSourceUrls = new Set(research.claims.map((c) => c.sourceUrl));
  for (const url of claimSourceUrls) {
    assert.ok(url.includes('careers.bcg.com'), `unexpected non-permitted source cited: ${url}`);
  }
});

test('JP3B culture research: named opinions carry author context; no fabricated insider/affinity/guarantee language appears anywhere', () => {
  const research = BCG_APPLICATION.cultureResearch;
  const opinions = research.claims.filter((c) => c.claimType === 'opinion');
  assert.ok(opinions.length > 0);
  assert.ok(opinions.every((c) => c.authorContext && c.authorContext.length > 0), 'every opinion needs author context');

  const forbiddenPatterns = [
    /\bi (?:personally )?know (?:someone|a friend|people) (?:who|at)\b/i,
    /\binsider (?:info|information|knowledge|source)\b/i,
    /\bguarantee(?:d)?\s+(?:you'?ll|to)?\s*(?:get|land|receive)\s+(?:the|an?)\s+(?:job|offer|interview)\b/i,
  ];
  const allText = research.claims.map((c) => c.claimText).join('\n');
  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(allText), false, `forbidden pattern ${pattern} matched generated culture-research text`);
  }
});
