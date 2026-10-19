import {Client} from '@distr-sh/distr-sdk';
import {WizardError} from './errors.ts';
import {docker} from './process.ts';
import {isAtLeast, parseVersion, type Version} from './version.ts';

const defaultApiBase = 'https://app.distr.sh/api/v1';
const minimumDockerEngine: Version = [29, 0, 0];

export type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

async function commandOutput(args: string[]): Promise<string | undefined> {
  const output = await docker(args);
  return output.code === 0 ? output.stdout.trim() : undefined;
}

export async function checkDockerEngine(): Promise<CheckResult> {
  const name = 'Docker Engine';
  const minimum = minimumDockerEngine.join('.');
  const output = await commandOutput(['version', '--format', '{{.Server.Version}}']);
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

export async function checkDockerCompose(): Promise<CheckResult> {
  const name = 'Docker Compose';
  const output = await commandOutput(['compose', 'version', '--short']);
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

export async function requireDocker(): Promise<string> {
  const [engine, compose] = await Promise.all([checkDockerEngine(), checkDockerCompose()]);
  if (!engine.ok) {
    const blocker = engine.detail.startsWith('not reachable') ? 'docker_missing' : 'docker_outdated';
    throw new WizardError(`Docker Engine: ${engine.detail}.`, 'preflight', blocker);
  } else if (!compose.ok) {
    throw new WizardError(`Docker Compose: ${compose.detail}.`, 'preflight', 'docker_missing');
  }
  return compose.detail;
}
