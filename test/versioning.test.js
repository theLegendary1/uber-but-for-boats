import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpVersion, flavorMessage } from '../scripts/versioning.js';

test('every commit advances semver, including docs and ordinary messages', () => {
  for (const message of ['fix: correct slot', 'docs: explain signup', 'chore: maintain tooling', 'Merge branch main', 'plain message']) {
    assert.equal(bumpVersion('1.2.3', message), '1.2.4');
  }
  assert.equal(bumpVersion('0.1.0', 'feat(schedule): add recurring washes'), '0.2.0');
  for (const message of ['feat!: replace booking API', 'fix(auth)!: replace sessions', 'feat: update API\n\nBREAKING CHANGE: remove old fields']) {
    assert.equal(bumpVersion('0.9.2', message), '1.0.0');
  }
  assert.throws(() => bumpVersion('broken', 'fix: test'), /semantic version/);
});

test('cast flavor preserves conventional prefix, body and trailers without duplication', () => {
  const message = 'feat: add booking\n\nClear technical explanation.\n\nCo-authored-by: Example <example@example.test>';
  const flavored = flavorMessage(message);
  assert.match(flavored, /^feat: add booking \[Dale:/);
  assert.ok(flavored.endsWith('Co-authored-by: Example <example@example.test>'));
  assert.equal(flavorMessage(flavored), flavored);
  assert.throws(() => flavorMessage(''), /required/);
});
