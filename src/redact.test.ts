import assert from 'node:assert/strict';
import {test} from 'node:test';
import {redact} from './redact.ts';

test('redact removes the known secrets and anything shaped like a credential', () => {
  const token = `distr-${'A'.repeat(22)}_${'b'.repeat(49)}`;
  const legacyToken = `distr-${'0123456789abcdef'.repeat(2)}`;
  const jwt = `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(20)}.${'c'.repeat(20)}`;
  const text = [
    'password hunter2-secret',
    `Authorization: AccessToken ${token}`,
    `legacy ${legacyToken}`,
    `bearer ${jwt}`,
    'GET /api/v1/connect?targetId=1&targetSecret=s3cr3t HTTP/1.1',
    'DISTR_TARGET_SECRET=abc123',
    'container distr-local-distr-1',
  ].join('\n');

  assert.equal(
    redact(text, ['hunter2-secret', '']),
    [
      'password [REDACTED]',
      'Authorization: AccessToken [REDACTED]',
      'legacy [REDACTED]',
      'bearer [REDACTED]',
      'GET /api/v1/connect?targetId=1&targetSecret=[REDACTED] HTTP/1.1',
      'DISTR_TARGET_SECRET=[REDACTED]',
      'container distr-local-distr-1',
    ].join('\n')
  );
});
