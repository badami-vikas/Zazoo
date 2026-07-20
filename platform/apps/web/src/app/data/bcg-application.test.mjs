import test from 'node:test';
import assert from 'node:assert/strict';

import { BCG_APPLICATION } from './bcg-application.ts';

test('BCG application organization contains the complete governed result set', () => {
  assert.equal(BCG_APPLICATION.company, 'Boston Consulting Group');
  assert.equal(BCG_APPLICATION.role, 'Consultant — MBA');
  assert.equal(BCG_APPLICATION.submission.requiresHumanApproval, true);

  const resultIds = new Set(BCG_APPLICATION.results.map((result) => result.id));
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
    assert.ok(resultIds.has(required), `missing ${required}`);
  }
});

test('every application claim is traceable and unresolved evidence stays visible', () => {
  assert.ok(BCG_APPLICATION.evidence.length >= 8);
  assert.ok(BCG_APPLICATION.evidence.every((claim) => claim.source && claim.status));
  assert.ok(BCG_APPLICATION.evidence.some((claim) => claim.status === 'needs-review'));
  assert.ok(BCG_APPLICATION.results.every((result) => result.ownerAgent && result.skill));
});

test('interview preparation reflects BCG official evaluation dimensions', () => {
  const dimensions = new Set(BCG_APPLICATION.fit.dimensions.map((item) => item.label));
  for (const dimension of ['Integrity', 'Intellectual curiosity', 'Creative thinking', 'Collaborative mindset', 'Drive']) {
    assert.ok(dimensions.has(dimension), `missing ${dimension}`);
  }

  const casePrep = BCG_APPLICATION.results.find((result) => result.id === 'case-prep');
  assert.ok(casePrep.sections.some((section) => section.body.includes('structure')));
  assert.ok(casePrep.sections.some((section) => section.body.includes('calculation')));
});
