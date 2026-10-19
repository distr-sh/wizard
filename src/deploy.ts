import {readFile} from 'node:fs/promises';
import {connectController} from './controller.ts';
import {
  deployVersion,
  ensureApplication,
  ensureSecret,
  ensureTestCustomer,
  findApplication,
  printLogs,
  readLogs,
  waitForDeployment,
  waitForLogs,
} from './deployments.ts';
import {LocalDistr} from './distr.ts';
import {UsageError, WizardError} from './errors.ts';
import {info} from './output.ts';
import {distrUrl, loadState, newState, type State} from './state.ts';
import {track} from './telemetry.ts';

export type DeployOptions = {
  name?: string;
  appVersion?: string;
  compose?: string;
  template?: string;
  env?: string;
  secrets: string[];
  link?: string;
};

async function readInput(path: string, flag: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new UsageError(`Cannot read ${path} given as ${flag}.`);
  }
}

export async function deploy(options: DeployOptions) {
  if (!options.name || !options.appVersion || !options.compose) {
    throw new UsageError('deploy needs --name, --app-version and --compose.');
  }
  for (const key of options.secrets) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new UsageError(`--secret takes the key of a secret, not a value: "${key}" is not a valid key.`);
    }
  }
  const composeFile = await readInput(options.compose, '--compose');
  const templateFile = options.template ? await readInput(options.template, '--template') : undefined;
  const envFile = options.env ? await readInput(options.env, '--env') : undefined;

  const startedAt = Date.now();
  const state = (await loadState()) ?? newState();
  const distr = await LocalDistr.open(state);
  const application = await ensureApplication(distr, options.name);
  if (application.versions?.some((version) => version.name === options.appVersion)) {
    throw new UsageError(
      `${options.name} already has version ${options.appVersion}, and a version cannot change. ` +
        'Pass a new --app-version such as the next patch version.'
    );
  }
  info(`Creating version ${options.appVersion} of ${options.name}`);
  const version = await distr.service.createDockerApplicationVersion(application.id!, options.appVersion, {
    composeFile,
    templateFile,
    linkTemplate: options.link,
  });
  const customer = await ensureTestCustomer(state, distr);
  for (const key of options.secrets) {
    await ensureSecret(distr, customer.customerOrganizationId, key);
  }
  const deploymentId = await deployVersion(distr, customer.deploymentTargetId, application.id!, version.id!, envFile);
  await connectController(state, distr, customer.deploymentTargetId);

  let status;
  try {
    status = await waitForDeployment(distr, customer.deploymentTargetId, deploymentId, ['healthy', 'running']);
  } catch (error) {
    if (error instanceof WizardError) {
      printLogs(await readLogs(distr, deploymentId, 30));
    }
    throw error;
  }
  const logs = await waitForLogs(distr, deploymentId, 60_000);
  printLogs(logs);
  await track(state, 'deployed', {app: 'own', minutes: Math.ceil((Date.now() - startedAt) / 60_000)});
  return {
    application: {id: application.id, name: options.name, version: options.appVersion},
    customerOrganizationId: customer.customerOrganizationId,
    deploymentTargetId: customer.deploymentTargetId,
    deploymentId,
    status,
    distrUrl: distrUrl(state),
    logResources: Object.keys(logs),
  };
}

export async function findDeployment(state: State, distr: LocalDistr, name: string) {
  const deploymentTargetId = state.testCustomer?.deploymentTargetId;
  const application = await findApplication(distr, name);
  if (!deploymentTargetId || !application) {
    throw new UsageError(`There is no deployment of ${name} yet.`);
  }
  const target = await distr.client.getDeploymentTarget(deploymentTargetId);
  const deployment = target.deployments.find((candidate) => candidate.applicationId === application.id);
  if (!deployment?.id) {
    throw new UsageError(`There is no deployment of ${name} yet.`);
  }
  return {target, deployment};
}
