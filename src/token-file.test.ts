import assert from 'node:assert/strict';
import {chmod, mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {saveToken, tokenFile} from './token-file.ts';

test('the token file lives under an absolute XDG_CONFIG_HOME, and under ~/.config otherwise', () => {
  assert.equal(tokenFile({XDG_CONFIG_HOME: '/xdg'}, '/home/user'), '/xdg/distr/token');
  assert.equal(tokenFile({XDG_CONFIG_HOME: 'relative'}, '/home/user'), '/home/user/.config/distr/token');
  assert.equal(tokenFile({}, '/home/user'), '/home/user/.config/distr/token');
});

test(
  'saving replaces a file readable by others with one only the user can read',
  {skip: process.platform === 'win32'},
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'distr-wizard-'));
    try {
      const file = join(dir, 'distr', 'token');
      await saveToken(file, 'distr-old');
      await chmod(file, 0o644);
      await saveToken(file, 'distr-new');
      assert.equal(await readFile(file, 'utf8'), 'distr-new\n');
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.equal((await stat(join(dir, 'distr'))).mode & 0o777, 0o700);
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  }
);
