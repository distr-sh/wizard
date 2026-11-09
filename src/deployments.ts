import type {Application, DeploymentStatusType} from '@distr-sh/distr-sdk';
import {randomBytes} from 'node:crypto';
import {testCustomerName, testTargetName} from './constants.ts';
import type {LocalDistr, LogRecord} from './distr.ts';
import {WizardError} from './errors.ts';
import {info, sleep} from './output.ts';
import {saveState, type State} from './state.ts';

export type TestCustomer = {customerOrganizationId: string; deploymentTargetId: string};

export async function findApplication(distr: LocalDistr, name: string): Promise<Application | undefined> {
  const applications = await distr.client.getApplications();
  const found = applications.find((application) => application.name === name);
  return found?.id ? distr.client.getApplication(found.id) : undefined;
}

export async function ensureApplication(distr: LocalDistr, name: string): Promise<Application> {
  const existing = await findApplication(distr, name);
  if (existing) {
    return existing;
  }
  info(`Creating the application ${name}`);
  return distr.client.createApplication({name, type: 'docker'});
}

/** The customer every local deployment goes to, with the one Docker deployment target the Community Edition allows. */
export async function ensureTestCustomer(state: State, distr: LocalDistr): Promise<TestCustomer> {
  const customers = await distr.customerOrganizations();
  let customer = customers.find((candidate) => candidate.name === testCustomerName);
  if (!customer) {
    info(`Creating the customer ${testCustomerName}`);
    customer = await distr.createCustomerOrganization(testCustomerName);
  }
  const targets = await distr.client.getDeploymentTargets();
  let target = targets.find(
    (candidate) => candidate.customerOrganization?.id === customer.id && candidate.type === 'docker'
  );
  if (!target) {
    info(`Creating the deployment target ${testTargetName} of ${testCustomerName}`);
    target = await distr.client.createDeploymentTarget({
      name: testTargetName,
      type: 'docker',
      customerOrganizationId: customer.id,
      deploymentLogsEnabled: true,
      // Metrics need mount propagation that Docker Desktop does not provide.
      metricsEnabled: false,
      imageCleanupEnabled: false,
    });
  }
  state.testCustomer = {customerOrganizationId: customer.id, deploymentTargetId: target.id!};
  await saveState(state);
  return state.testCustomer;
}

/** Creates a customer secret with a random value unless it exists. The value is never printed. */
export async function ensureSecret(distr: LocalDistr, customerOrganizationId: string, key: string): Promise<void> {
  const secrets = await distr.secrets();
  if (!secrets.some((secret) => secret.key === key && secret.customerOrganizationId === customerOrganizationId)) {
    info(`Creating the secret ${key} of ${testCustomerName}`);
    await distr.createSecret(key, randomBytes(16).toString('hex'), customerOrganizationId);
  }
}

async function deploymentOf(distr: LocalDistr, deploymentTargetId: string, applicationId: string) {
  const target = await distr.client.getDeploymentTarget(deploymentTargetId);
  return (target.deployments ?? []).find((deployment) => deployment.applicationId === applicationId);
}

/** Deploys a version, or moves the application's existing deployment on the target to it. Returns the deployment ID. */
export async function deployVersion(
  distr: LocalDistr,
  deploymentTargetId: string,
  applicationId: string,
  applicationVersionId: string,
  envFile: string | undefined
): Promise<string> {
  const existing = await deploymentOf(distr, deploymentTargetId, applicationId);
  await distr.client.createOrUpdateDeployment({
    deploymentTargetId,
    applicationVersionId,
    deploymentId: existing?.id,
    dockerType: 'compose',
    envFileData: envFile === undefined ? undefined : Buffer.from(envFile).toString('base64'),
  });
  // The endpoint answers without a body, so the deployment is read from the target.
  const deployment = await deploymentOf(distr, deploymentTargetId, applicationId);
  if (!deployment?.id) {
    throw new WizardError('Distr accepted the deployment but the target does not list it.', 'deploy');
  }
  return deployment.id;
}

export type DeploymentStatus = {type: DeploymentStatusType | 'pending'; message: string};

export async function waitForDeployment(
  distr: LocalDistr,
  deploymentTargetId: string,
  deploymentId: string,
  accepted: DeploymentStatusType[]
): Promise<DeploymentStatus> {
  const deadline = Date.now() + 10 * 60_000;
  let errorSince: number | undefined;
  let last = '';
  for (;;) {
    const target = await distr.client.getDeploymentTarget(deploymentTargetId);
    const latest = target.deployments.find((deployment) => deployment.id === deploymentId)?.latestStatus;
    const status: DeploymentStatus = {type: latest?.type ?? 'pending', message: latest?.message ?? ''};
    const line = `${status.type} ${status.message}`.trim();
    if (line !== last) {
      info(`Deployment: ${line}`);
      last = line;
    }
    if ((accepted as string[]).includes(status.type)) {
      return status;
    }
    errorSince = status.type === 'error' ? (errorSince ?? Date.now()) : undefined;
    if (errorSince !== undefined && Date.now() - errorSince > 2 * 60_000) {
      throw new WizardError(
        `The deployment failed for two minutes: ${status.message || 'no status message'}`,
        'deploy',
        'deployment_unhealthy'
      );
    } else if (Date.now() > deadline) {
      throw new WizardError(
        `The deployment did not become ${accepted.join(' or ')} within ten minutes, its status is ${line}.`,
        'deploy',
        'deployment_unhealthy'
      );
    }
    await sleep(10_000);
  }
}

/** Waits until the controller has shipped logs, which it sends in batches some time after the containers start. */
export async function waitForLogs(
  distr: LocalDistr,
  deploymentId: string,
  timeoutMilliseconds = 120_000
): Promise<Record<string, LogRecord[]>> {
  const deadline = Date.now() + timeoutMilliseconds;
  for (;;) {
    const logs = await readLogs(distr, deploymentId, 5);
    if (Object.values(logs).some((records) => records.length > 0) || Date.now() > deadline) {
      return logs;
    }
    await sleep(5_000);
  }
}

export async function readLogs(
  distr: LocalDistr,
  deploymentId: string,
  limit: number
): Promise<Record<string, LogRecord[]>> {
  const logs: Record<string, LogRecord[]> = {};
  for (const resource of await distr.logResources(deploymentId)) {
    logs[resource] = await distr.logs(deploymentId, resource, limit);
  }
  return logs;
}

/** Renders the logs of each resource oldest first, while Distr returns the newest first. */
export function formatLogs(logs: Record<string, LogRecord[]>): string[] {
  return Object.entries(logs).flatMap(([resource, records]) => [
    `== ${resource}`,
    ...records
      .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((record) => `${record.timestamp} ${record.body}`),
  ]);
}

export function printLogs(logs: Record<string, LogRecord[]>): void {
  formatLogs(logs).forEach((line) => info(line));
}
