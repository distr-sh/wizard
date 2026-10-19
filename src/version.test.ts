import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isAtLeast, parseVersion} from './version.ts';

test('parseVersion reads the versions Docker reports', () => {
  assert.deepEqual(parseVersion('29.1.3\n'), [29, 1, 3]);
  assert.deepEqual(parseVersion('v2.39.1'), [2, 39, 1]);
  assert.deepEqual(parseVersion('5.1.0-desktop.1'), [5, 1, 0]);
  assert.deepEqual(parseVersion('28'), [28, 0, 0]);
  assert.equal(parseVersion('unknown'), undefined);
});

test('isAtLeast compares numerically, not lexically', () => {
  assert.equal(isAtLeast([29, 0, 0], [29, 0, 0]), true);
  assert.equal(isAtLeast([29, 10, 0], [29, 9, 0]), true);
  assert.equal(isAtLeast([28, 99, 99], [29, 0, 0]), false);
  assert.equal(isAtLeast([29, 0, 1], [29, 1, 0]), false);
});
