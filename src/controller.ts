import {controllerProject} from './constants.ts';
import type {LocalDistr} from './distr.ts';
import {WizardError} from './errors.ts';
import {info, sleep} from './output.ts';
import {docker} from './process.ts';
import {home, saveState, type State} from './state.ts';

export async function controllerContainers(): Promise<string[]> {
  const output = await docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${controllerProject}`]);
  return output.stdout.split('\n').filter(Boolean);
}

export async function containerEnv(container: string): Promise<Record<string, string>> {
  const output = await docker(['inspect', container, '--format', '{{json .Config.Env}}']);
  if (output.code !== 0) {
    return {};
  }
  const entries = (JSON.parse(output.stdout) as string[] | null) ?? [];
  return Object.fromEntries(
    entries.map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)])
  );
}

async function isRunning(container: string): Promise<boolean> {
  return (await docker(['ps', '-q', '--filter', `id=${container}`])).stdout.trim() !== '';
}

/** The controllers on this machine that belong to deployment targets the wizard connected. */
export async function ownedControllerContainers(state: State): Promise<string[]> {
  const owned: string[] = [];
  for (const container of await controllerContainers()) {
    const targetId = (await containerEnv(container)).DISTR_TARGET_ID;
    if (targetId && state.controllerTargetIds.includes(targetId)) {
      owned.push(container);
    }
  }
  return owned;
}

/** The Compose projects of the applications a Docker controller deployed. */
export async function applicationProjects(container: string): Promise<string[]> {
  // docker cp also reads the scratch volume of a stopped controller, which docker exec cannot.
  const archive = await docker(['cp', `${container}:/scratch/deployments`, '-']);
  const projects = new Set<string>();
  for (const match of archive.stdout.matchAll(/"projectName":\s*"([^"]+)"/g)) {
    projects.add(match[1]);
  }
  return [...projects];
}

/** Waits until the controller reported to Distr, after since when given and the target has a deployment to report. */
async function waitForController(distr: LocalDistr, deploymentTargetId: string, since?: Date): Promise<void> {
  for (let second = 0; ; second += 3) {
    const target = await distr.client.getDeploymentTarget(deploymentTargetId);
    const reported =
      since && target.deployments.length > 0
        ? target.deployments.some(
            (deployment) => deployment.latestStatus?.createdAt && new Date(deployment.latestStatus.createdAt) > since
          )
        : target.reportedControllerVersionId !== undefined;
    if (reported) {
      info(`The Distr controller of deployment target ${target.name} is connected.`);
      return;
    } else if (second >= 180) {
      throw new WizardError(
        'The Distr controller did not connect within 3 minutes. Run distr-wizard diagnose.',
        'connect',
        'controller_not_connecting'
      );
    } else if (second > 0 && second % 30 === 0) {
      info(`Waiting for the Distr controller to connect (${second} seconds)`);
    }
    await sleep(3_000);
  }
}

/**
 * Starts the Docker controller of a deployment target on this machine, or with replace applies a fresh manifest to the
 * running one. The connect URL contains the target secret, so it is never printed or written to a file.
 */
export async function connectController(
  state: State,
  distr: LocalDistr,
  deploymentTargetId: string,
  replace = false
): Promise<void> {
  const target = await distr.client.getDeploymentTarget(deploymentTargetId);
  if (target.type !== 'docker') {
    throw new WizardError('The wizard connects Docker deployment targets only.', 'connect');
  }
  for (const container of await controllerContainers()) {
    const other = (await containerEnv(container)).DISTR_TARGET_ID;
    if (!other) {
      continue;
    } else if (other === deploymentTargetId && !replace && (await isRunning(container))) {
      // Every new connect URL rotates the target secret, so a running controller is left alone.
      return waitForController(distr, deploymentTargetId);
    } else if (!state.controllerTargetIds.includes(other)) {
      throw new WizardError(
        `A Distr controller of another installation already runs as the Docker Compose project ${controllerProject} ` +
          'on this machine. Connecting would replace it and remove its applications, so stop and ask the user.',
        'connect',
        'controller_conflict'
      );
    }
  }

  const {connectUrl} = await distr.client.createAccessForDeploymentTarget(deploymentTargetId);
  if (!state.controllerTargetIds.includes(deploymentTargetId)) {
    state.controllerTargetIds.push(deploymentTargetId);
    await saveState(state);
  }
  const response = await fetch(connectUrl, {signal: AbortSignal.timeout(30_000)});
  if (!response.ok) {
    throw new WizardError(
      `Could not download the Distr controller manifest: ${response.status}`,
      'connect',
      'controller_not_connecting'
    );
  }
  info(`Starting the Distr controller of deployment target ${target.name}`);
  const since = new Date();
  const started = await docker(['compose', '-f', '-', 'up', '-d'], {
    cwd: home,
    input: await response.text(),
    show: true,
  });
  if (started.code !== 0) {
    throw new WizardError(
      'Could not start the Distr controller, see the output above.',
      'connect',
      'controller_not_connecting'
    );
  }
  await waitForController(distr, deploymentTargetId, since);
}
