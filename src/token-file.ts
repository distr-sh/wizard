import {chmod, mkdir, rename, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join} from 'node:path';

export function tokenFile(env: NodeJS.ProcessEnv, home = homedir()): string {
  const configHome =
    env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
  return join(configHome, 'distr', 'token');
}

export async function saveToken(file: string, token: string): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, {recursive: true, mode: 0o700});
  // mkdir leaves the mode of an existing directory alone.
  await chmod(dir, 0o700);
  // Writing a new file and renaming it over the old one keeps the old token when the write fails, and replaces a
  // file readable by others, whose mode writeFile would keep.
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${token}\n`, {mode: 0o600, flag: 'wx'});
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, {force: true});
    throw error;
  }
}
