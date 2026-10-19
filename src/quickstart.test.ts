import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setEnv, unsetEnv} from './quickstart.ts';

const env = '# DISTR_HOST=commented\nDISTR_HOST=\nDISTR_HOST_ALIAS=keep\nPOSTGRES_PASSWORD=\n';

test('setEnv replaces the variable and leaves commented and longer keys alone', () => {
  assert.equal(
    setEnv(env, 'DISTR_HOST', 'http://localhost:8080'),
    '# DISTR_HOST=commented\nDISTR_HOST="http://localhost:8080"\nDISTR_HOST_ALIAS=keep\nPOSTGRES_PASSWORD=\n'
  );
});

test('setEnv adds a missing variable before the final newline', () => {
  assert.equal(setEnv('A=1\n', 'B', '2'), 'A=1\nB="2"\n');
  assert.equal(setEnv('A=1', 'B', '2'), 'A=1\nB="2"');
});

test('unsetEnv removes only the exact variable', () => {
  assert.equal(unsetEnv(env, 'DISTR_HOST'), '# DISTR_HOST=commented\nDISTR_HOST_ALIAS=keep\nPOSTGRES_PASSWORD=\n');
});
