import {mkdir, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join} from 'node:path';

export function tokenFile(env: NodeJS.ProcessEnv, home = homedir()): string {
  const configHome =
    env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
  return join(configHome, 'distr', 'token');
}

export async function saveToken(file: string, token: string): Promise<void> {
  await mkdir(dirname(file), {recursive: true, mode: 0o700});
  // The mode of writeFile only applies to a file it creates, so an existing file readable by others is replaced.
  await rm(file, {force: true});
  await writeFile(file, `${token}\n`, {mode: 0o600, flag: 'wx'});
}
