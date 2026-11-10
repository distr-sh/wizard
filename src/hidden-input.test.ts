import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyInput} from './hidden-input.ts';

test('a pasted token ending in a newline completes the input', () => {
  assert.deepEqual(applyInput('', 'distr-abc\r'), {value: 'distr-abc', done: true, cancelled: false});
});

test('backspace removes the last character', () => {
  assert.deepEqual(applyInput('distr-ab', '\u007fc'), {value: 'distr-ac', done: false, cancelled: false});
});

test('ctrl-c cancels and drops what was typed', () => {
  assert.deepEqual(applyInput('distr-ab', '\u0003'), {value: '', done: false, cancelled: true});
});

test('escape sequences and other control characters are ignored', () => {
  assert.deepEqual(applyInput('distr-', '\u001b[D'), {value: 'distr-', done: false, cancelled: false});
  assert.deepEqual(applyInput('distr-', 'a\tb'), {value: 'distr-ab', done: false, cancelled: false});
});

test('escape sequences inside a chunk are dropped without losing what follows them', () => {
  assert.deepEqual(applyInput('', 'distr-a\u001b[Db\r'), {value: 'distr-ab', done: true, cancelled: false});
  assert.deepEqual(applyInput('', '\u001b[200~distr-abc\u001b[201~\r'), {
    value: 'distr-abc',
    done: true,
    cancelled: false,
  });
});
