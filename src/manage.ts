import {distrProject, distrVersion, registryHost, registrySlug} from './constants.ts';
import {
  applicationProjects,
  connectController,
  containerEnv,
  controllerContainers,
  ownedControllerContainers,
} from './controller.ts';
import {findDeployment} from './deploy.ts';
import {formatLogs, readLogs} from './deployments.ts';
import {LocalDistr} from './distr.ts';
import {UsageError, WizardError} from './errors.ts';
import {answers} from './http.ts';
import {info} from './output.ts';
import {packageVersion} from './package.ts';
import {docker} from './process.ts';
import {composeArgs} from './quickstart.ts';
import {redact} from './redact.ts';
import {distrUrl, home, loadState, paths, readOptional, removeHome, type State} from './state.ts';

async function requireState(): Promise<State> {
  const state = await loadState();
  if (!state) {
    throw new UsageError(`There is no local Distr in ${home} yet. Run distr-wizard up first.`);
  }
  return state;
}

export async function status() {
  const state = await requireState();
  const ready = await answers(`${distrUrl(state)}/ready`);
  const testCustomer = state.testCustomer;
  let deployments: unknown[] = [];
  if (ready && testCustomer) {
    const distr = await LocalDistr.open(state);
    const target = await distr.client.getDeploymentTarget(testCustomer.deploymentTargetId);
    deployments = target.deployments.map((deployment) => ({
      id: deployment.id,
      application: deployment.applicationName,
      version: deployment.applicationVersionName,
      status: deployment.latestStatus?.type ?? 'pending',
      message: deployment.latestStatus?.message ?? '',
    }));
  }
  return {distrUrl: distrUrl(state), ready, testCustomer, deployments, home};
}

export async function logs(name: string, limit: number): Promise<void> {
  const state = await requireState();
  const distr = await LocalDistr.open(state);
  const {deployment} = await findDeployment(state, distr, name);
  const records = await readLogs(distr, deployment.id!, limit);
  if (Object.keys(records).length === 0) {
    info('The controller has not sent logs yet. They arrive in batches shortly after the containers start.');
  }
  for (const line of formatLogs(records)) {
    process.stdout.write(`${line}\n`);
  }
}

export async function connect(): Promise<void> {
  const state = await requireState();
  if (!state.testCustomer) {
    throw new UsageError('There is no test customer yet. Run distr-wizard hello or distr-wizard deploy.');
  }
  await connectController(state, await LocalDistr.open(state), state.testCustomer.deploymentTargetId, true);
}

export async function registryLogin(): Promise<void> {
  await requireState();
  const token = (await readOptional(paths.token))?.trim();
  if (!token) {
    throw new UsageError('There is no API token yet. Run distr-wizard up first.');
  }
  const login = await docker(['login', registryHost, '-u', '-', '--password-stdin'], {input: token});
  if (login.code !== 0) {
    throw new WizardError(`docker login ${registryHost} failed: ${login.stderr.trim()}`, 'deploy');
  }
  info(`Logged in to ${registryHost}. Push images as ${registryHost}/${registrySlug}/<name>:<tag>.`);
}

async function secretsToRedact(): Promise<string[]> {
  const secrets = [(await readOptional(paths.token))?.trim()];
  const credentials = await readOptional(paths.credentials);
  if (credentials) {
    secrets.push((JSON.parse(credentials) as {password: string}).password);
  }
  for (const container of await controllerContainers()) {
    secrets.push((await containerEnv(container)).DISTR_TARGET_SECRET);
  }
  return secrets.filter((secret): secret is string => Boolean(secret));
}

export async function diagnose(): Promise<void> {
  const state = await requireState();
  const sections = [
    `distr-wizard ${await packageVersion()}, Distr ${distrVersion}, ${process.platform} ${process.arch}`,
    `Docker ${(await docker(['version', '--format', '{{.Server.Version}}'])).stdout.trim()}, ` +
      `Compose ${(await docker(['compose', 'version', '--short'])).stdout.trim()}`,
    `Distr: ${distrUrl(state)}, ready: ${(await answers(`${distrUrl(state)}/ready`)) ? 'yes' : 'no'}`,
  ];
  const containers = await docker([...composeArgs(), 'ps', '-a']);
  sections.push(`## Distr containers\n${containers.stdout}${containers.stderr}`);
  const distrLogs = await docker([...composeArgs(), 'logs', '--tail', '50', '--no-color', 'distr']);
  sections.push(`## Distr logs\n${distrLogs.stdout}${distrLogs.stderr}`);
  for (const container of await controllerContainers()) {
    const name = await docker(['inspect', container, '--format', '{{.Name}} {{.State.Status}}']);
    const controllerLogs = await docker(['logs', '--tail', '50', container]);
    sections.push(`## Controller ${name.stdout.trim()}\n${controllerLogs.stdout}${controllerLogs.stderr}`);
  }
  process.stdout.write(`${redact(sections.join('\n\n'), await secretsToRedact())}\n`);
}

async function composeDown(project: string): Promise<boolean> {
  return (
    (await docker(['compose', '-p', project, 'down', '-v', '--remove-orphans'], {cwd: '/', show: true})).code === 0
  );
}

/**
 * Removes the local Distr, the controllers the wizard connected and the applications they deployed. The wizard's
 * home is what identifies them, so it is only deleted once everything else is gone.
 */
export async function down() {
  const state = await loadState();
  if (!state) {
    info(`Nothing to remove: ${home} does not exist.`);
    return {removed: false};
  }
  if ((await docker(['info'])).code !== 0) {
    throw new WizardError('Docker is not running. Start it and run distr-wizard down again.', 'down', 'docker_missing');
  }
  const ready = await answers(`${distrUrl(state)}/ready`);
  if (ready && state.testCustomer) {
    // Targets created by hand in the local Distr belong to this installation as well.
    try {
      const distr = await LocalDistr.open(state);
      for (const target of await distr.client.getDeploymentTargets()) {
        if (target.id && !state.controllerTargetIds.includes(target.id)) {
          state.controllerTargetIds.push(target.id);
        }
      }
    } catch {
      // The targets the wizard recorded itself are enough to remove its controllers.
    }
  }

  const failed: string[] = [];
  for (const container of await ownedControllerContainers(state)) {
    for (const project of await applicationProjects(container)) {
      if (!(await composeDown(project))) {
        failed.push(`application ${project}`);
      }
    }
    const project = (
      await docker(['inspect', container, '--format', '{{index .Config.Labels "com.docker.compose.project"}}'])
    ).stdout.trim();
    if (project && !(await composeDown(project))) {
      failed.push(`controller ${project}`);
    }
  }
  if ((await docker([...composeArgs(), 'down', '-v', '--remove-orphans'], {show: true})).code !== 0) {
    if (!(await composeDown(distrProject))) {
      failed.push('Distr');
    }
  }
  await docker(['logout', registryHost]);
  if (failed.length > 0) {
    throw new WizardError(
      `Could not remove ${failed.join(', ')}. ${home} is kept, fix the error above and run distr-wizard down again.`,
      'down'
    );
  }
  await removeHome();
  info('Removed the local Distr, its controllers and the applications they deployed.');
  return {removed: true};
}
