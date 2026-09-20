// Self-check for the matcher: fails if label matching or text parsing breaks. Run: node test.cjs
const assert = require('node:assert/strict');
const M = require('./match.js');
const src = [
  { key: 'First Name', value: 'Jane' }, { key: 'Last Name', value: 'Okafor' }, { key: 'Email Address', value: 'j@x.com' },
  { key: 'Phone', value: '415' }, { key: 'Date of Birth', value: '1985-03-14' }, { key: 'Street Address', value: '1200 Mission' },
  { key: 'ZIP', value: '94103' }, { key: 'State', value: 'California' }, { key: 'Vehicle Year', value: '2019' }, { key: 'VIN', value: 'X' },
];
const hit = (label) => M.best(label, src)?.field.key ?? null;
assert.equal(hit('Given name'), 'First Name');
assert.equal(hit('Surname'), 'Last Name');
assert.equal(hit('E-mail'), 'Email Address');
assert.equal(hit('Mobile number'), 'Phone');
assert.equal(hit('Birth date'), 'Date of Birth');
assert.equal(hit('Address line 1'), 'Street Address');
assert.equal(hit('Postal code'), 'ZIP');
assert.equal(hit('Province'), 'State');
assert.equal(hit('Vehicle Identification Number'), 'VIN');
assert.equal(hit('Year'), 'Vehicle Year', 'unambiguous subset match');
assert.equal(hit('Name'), null, 'ambiguous subset (first/last) must not guess');
assert.equal(hit('Annual mileage'), null, 'unrelated label stays empty');
assert.deepEqual(M.parseText('Name: Jane\nnoise line\nPhone = 415\n'), [{ key: 'Name', value: 'Jane' }, { key: 'Phone', value: '415' }]);
assert.deepEqual(M.dedupe([{ key: 'A ', value: ' 1' }, { key: 'a', value: '2' }, { key: 'B', value: '' }]), [{ key: 'A', value: '1' }]);
for (const [phrase, want] of [['copy the details', 'copy'], ['recall and paste it', 'paste'], ['what do you have?', 'recall'], ['copy and show me', 'copy'], ['forget everything', 'clear'], ['hello', 'help']]) assert.equal(M.intent(phrase), want, phrase);
console.log('ok');
