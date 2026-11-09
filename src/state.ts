import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {defaultPort} from './constants.ts';

export const home = process.env.DISTR_WIZARD_HOME || join(homedir(), '.distr', 'local');

export const paths = {
  state: join(home, 'state.json'),
  token: join(home, 'token'),
  credentials: join(home, 'credentials.json'),
  quickstart: join(home, 'quickstart'),
  helloDistr: join(home, 'hello-distr'),
};

export type State = {
  /** Anonymous ID of this installation, also the distinct ID of its usage events. */
  installationId: string;
  port: number;
  image?: string;
  quickstartDir?: string;
  telemetryNoticeShown?: boolean;
  /** Deployment targets whose controllers the wizard started, so that down removes them and nothing else. */
  controllerTargetIds: string[];
  testCustomer?: {customerOrganizationId: string; deploymentTargetId: string};
};

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function loadState(): Promise<State | undefined> {
  const content = await readOptional(paths.state);
  return content === undefined ? undefined : (JSON.parse(content) as State);
}

export function newState(): State {
  return {installationId: randomUUID(), port: defaultPort, controllerTargetIds: []};
}

export async function saveState(state: State): Promise<void> {
  await mkdir(home, {recursive: true, mode: 0o700});
  await writeFile(paths.state, `${JSON.stringify(state, null, 2)}\n`);
}

export async function writePrivateFile(path: string, content: string): Promise<void> {
  await mkdir(home, {recursive: true, mode: 0o700});
  await writeFile(path, content, {mode: 0o600});
}

export async function removeHome(): Promise<void> {
  await rm(home, {recursive: true, force: true});
}

export function distrUrl(state: State): string {
  return `http://localhost:${state.port}`;
}

export function apiBase(state: State): string {
  return `${distrUrl(state)}/api/v1`;
}
