import {Client} from '@distr-sh/distr-sdk';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isAtLeast, parseVersion, type Version} from './version.ts';

const execFileAsync = promisify(execFile);

const defaultApiBase = 'https://app.distr.sh/api/v1';
const minimumDockerEngine: Version = [29, 0, 0];

export type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

async function commandOutput(file: string, args: string[]): Promise<string | undefined> {
  try {
    const {stdout} = await execFileAsync(file, args, {timeout: 15_000});
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function checkDockerEngine(): Promise<CheckResult> {
  const name = 'Docker Engine';
  const minimum = minimumDockerEngine.join('.');
  const output = await commandOutput('docker', ['version', '--format', '{{.Server.Version}}']);
  if (output === undefined) {
    return {name, ok: false, detail: 'not reachable, install Docker and start the Docker daemon'};
  }
  const version = parseVersion(output);
  if (version === undefined) {
    return {name, ok: false, detail: `cannot read the version "${output}"`};
  } else if (!isAtLeast(version, minimumDockerEngine)) {
    return {name, ok: false, detail: `${output} found, the Distr quickstart needs ${minimum} or later`};
  } else {
    return {name, ok: true, detail: output};
  }
}

async function checkDockerCompose(): Promise<CheckResult> {
  const name = 'Docker Compose';
  const output = await commandOutput('docker', ['compose', 'version', '--short']);
  if (output === undefined) {
    return {name, ok: false, detail: 'the docker compose plugin is missing'};
  }
  return {name, ok: true, detail: output};
}

async function checkDistrToken(apiBase: string, apiKey: string): Promise<CheckResult> {
  const name = 'Distr API';
  try {
    const applications = await new Client({apiBase, apiKey}).getApplications();
    return {name, ok: true, detail: `${apiBase} answers, applications: ${applications.length}`};
  } catch (error) {
    return {name, ok: false, detail: `${apiBase}: ${error instanceof Error ? error.message : String(error)}`};
  }
}

export async function doctor(env: NodeJS.ProcessEnv): Promise<CheckResult[]> {
  const checks = [checkDockerEngine(), checkDockerCompose()];
  if (env.DISTR_TOKEN) {
    checks.push(checkDistrToken(env.DISTR_API_BASE || defaultApiBase, env.DISTR_TOKEN));
  }
  return Promise.all(checks);
}
