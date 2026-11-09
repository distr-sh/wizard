import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {defaultPort, distrProject, distrVersion, registryHost, registryPort} from './constants.ts';
import {WizardError} from './errors.ts';
import {fetchText} from './http.ts';
import {distrUrl, paths, readOptional, writePrivateFile, type State} from './state.ts';

const files = {
  compose: join(paths.quickstart, 'docker-compose.yaml'),
  env: join(paths.quickstart, '.env'),
  override: join(paths.quickstart, 'compose.override.yaml'),
  release: join(paths.quickstart, '.release'),
};

/** The docker compose arguments every command for the local Distr uses, so start and teardown always match. */
export function composeArgs(): string[] {
  const args = ['compose', '-p', distrProject, '--project-directory', paths.quickstart, '--env-file', files.env];
  args.push('-f', files.compose);
  if (existsSync(files.override)) {
    args.push('-f', files.override);
  }
  return args;
}

/** Sets a variable in the content of a .env file, replacing its line when there is one. */
export function setEnv(content: string, key: string, value: string): string {
  const line = `${key}="${value}"`;
  const lines = content.split('\n');
  const index = lines.findIndex((existing) => existing.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = line;
  } else if (lines.at(-1) === '') {
    lines.splice(-1, 0, line);
  } else {
    lines.push(line);
  }
  return lines.join('\n');
}

export function unsetEnv(content: string, key: string): string {
  return content
    .split('\n')
    .filter((line) => !line.startsWith(`${key}=`))
    .join('\n');
}

async function quickstartFile(state: State, name: string): Promise<string> {
  if (state.quickstartDir) {
    return readFile(join(state.quickstartDir, name), 'utf8');
  }
  const url = `https://raw.githubusercontent.com/distr-sh/distr/${distrVersion}/deploy/docker/quickstart/${name}`;
  try {
    return await fetchText(url);
  } catch (error) {
    throw new WizardError(
      `Could not download the Distr ${distrVersion} quickstart: ${error instanceof Error ? error.message : error}`,
      'preflight'
    );
  }
}

/**
 * Writes the quickstart into the wizard's home and generates its secrets on the first run. Returns whether the
 * environment of an existing installation changed, which requires restarting Distr.
 */
export async function prepareQuickstart(state: State): Promise<{composeFile: string; envChanged: boolean}> {
  await mkdir(paths.quickstart, {recursive: true});
  if (state.quickstartDir || !existsSync(files.compose) || (await readOptional(files.release)) !== distrVersion) {
    await writeFile(files.compose, await quickstartFile(state, 'docker-compose.yaml'));
    await writeFile(files.release, state.quickstartDir ? '' : distrVersion);
  }

  const previousEnv = await readOptional(files.env);
  let env = previousEnv ?? (await quickstartFile(state, '.env'));
  if (previousEnv === undefined) {
    env = setEnv(env, 'JWT_SECRET', randomBytes(32).toString('base64'));
    env = setEnv(env, 'DATABASE_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    env = setEnv(env, 'POSTGRES_PASSWORD', randomBytes(16).toString('hex'));
    env = setEnv(env, 'RUSTFS_SECRET_KEY', randomBytes(16).toString('hex'));
  }
  env = setEnv(env, 'DISTR_HOST', distrUrl(state));
  env = setEnv(env, 'REGISTRY_HOST', registryHost);
  env = unsetEnv(env, 'CONTROLLER_HOST');
  await writePrivateFile(files.env, env);

  const overrides: string[] = [];
  if (state.image) {
    overrides.push(`    image: ${state.image}`);
  }
  if (state.port !== defaultPort) {
    overrides.push(`    ports: !override\n      - '${state.port}:8080'\n      - '${registryPort}:8585'`);
  }
  if (overrides.length > 0) {
    await writeFile(files.override, `services:\n  distr:\n${overrides.join('\n')}\n`);
  } else {
    await rm(files.override, {force: true});
  }

  return {
    composeFile: await readFile(files.compose, 'utf8'),
    envChanged: previousEnv !== undefined && previousEnv !== env,
  };
}
