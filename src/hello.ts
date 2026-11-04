import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {controllerProject, helloDistrVersion} from './constants.ts';
import {applicationProjects, connectController, ownedControllerContainers} from './controller.ts';
import {
  deployVersion,
  ensureApplication,
  ensureSecret,
  ensureTestCustomer,
  printLogs,
  waitForDeployment,
  waitForLogs,
} from './deployments.ts';
import {LocalDistr} from './distr.ts';
import {WizardError} from './errors.ts';
import {answers, fetchText} from './http.ts';
import {info, sleep} from './output.ts';
import {portInUse} from './ports.ts';
import {docker} from './process.ts';
import {distrUrl, loadState, newState, paths, type State} from './state.ts';
import {track} from './telemetry.ts';

const applicationName = 'hello-distr';
const ports = [80, 443];
const deploymentEnv = `HELLO_DISTR_HOST=localhost
HELLO_DISTR_PROTOCOL=http
HELLO_DISTR_DB_NAME=hello-distr
HELLO_DISTR_DB_USER=hello-distr
HELLO_DISTR_DB_PASSWORD={{ .Secrets.HELLO_DISTR_DB_PASSWORD }}
`;

async function helloDistrFiles(): Promise<{composeFile: string; templateFile: string}> {
  const base = `https://raw.githubusercontent.com/distr-sh/hello-distr/${helloDistrVersion}/deploy`;
  const [composeFile, templateFile] = await Promise.all([
    fetchText(`${base}/docker-compose.yaml`),
    fetchText(`${base}/env.template`),
  ]);
  await mkdir(paths.helloDistr, {recursive: true});
  await writeFile(join(paths.helloDistr, 'docker-compose.yaml'), composeFile);
  await writeFile(join(paths.helloDistr, 'env.template'), templateFile);
  return {composeFile, templateFile};
}

/** Fails when something the wizard did not deploy holds one of the ports Hello Distr publishes. */
async function requireFreePorts(state: State): Promise<void> {
  const ownProjects = new Set<string>([controllerProject]);
  for (const container of await ownedControllerContainers(state)) {
    for (const project of await applicationProjects(container)) {
      ownProjects.add(project);
    }
  }
  for (const port of ports) {
    if (!(await portInUse(port))) {
      continue;
    }
    const holder = await docker([
      'ps',
      '--filter',
      `publish=${port}`,
      '--format',
      '{{.Label "com.docker.compose.project"}}',
    ]);
    if (!holder.stdout.split('\n').some((project) => ownProjects.has(project))) {
      throw new WizardError(
        `Hello Distr needs port ${port}, which something else on this machine uses. Free it or skip distr-wizard hello.`,
        'deploy',
        'port_in_use'
      );
    }
  }
}

export async function hello() {
  const startedAt = Date.now();
  const state = (await loadState()) ?? newState();
  const distr = await LocalDistr.open(state);
  await requireFreePorts(state);

  const files = await helloDistrFiles();
  const application = await ensureApplication(distr, applicationName);
  let version = application.versions?.find((candidate) => candidate.name === helloDistrVersion);
  if (!version) {
    info(`Creating version ${helloDistrVersion} of ${applicationName}`);
    version = await distr.service.createDockerApplicationVersion(application.id!, helloDistrVersion, {
      ...files,
      linkTemplate: 'http://localhost',
    });
  }
  const customer = await ensureTestCustomer(state, distr);
  await ensureSecret(distr, customer.customerOrganizationId, 'HELLO_DISTR_DB_PASSWORD');
  const deploymentId = await deployVersion(
    distr,
    customer.deploymentTargetId,
    application.id!,
    version.id!,
    deploymentEnv
  );

  await connectController(state, distr, customer.deploymentTargetId);
  info('Waiting for Hello Distr. The controller downloads its images first, which takes a few minutes the first time.');
  const status = await waitForDeployment(distr, customer.deploymentTargetId, deploymentId, ['healthy']);

  for (let attempt = 0; !(await answers('http://localhost/api/health', 5_000)); attempt++) {
    if (attempt >= 12) {
      throw new WizardError(
        'Hello Distr is healthy in Distr but http://localhost/api/health does not answer.',
        'deploy'
      );
    }
    await sleep(5_000);
  }

  info('Waiting for the controller to send the first logs to Distr');
  const logs = await waitForLogs(distr, deploymentId);
  printLogs(logs);
  await track(state, 'deployed', {app: 'hello-distr', minutes: Math.ceil((Date.now() - startedAt) / 60_000)});
  info(`Hello Distr runs at http://localhost. See the customer and its deployment in Distr at ${distrUrl(state)}.`);
  return {
    application: {id: application.id, name: applicationName, version: helloDistrVersion},
    customerOrganizationId: customer.customerOrganizationId,
    deploymentTargetId: customer.deploymentTargetId,
    deploymentId,
    status,
    url: 'http://localhost',
    logResources: Object.keys(logs),
    logLines: Object.values(logs).reduce((total, records) => total + records.length, 0),
    next: 'Package the application of this repository and ship it with distr-wizard deploy. See distr-wizard guide.',
  };
}
