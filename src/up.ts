import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {adminEmail, distrProject, registryHost, registryPort, registrySlug} from './constants.ts';
import {requireDocker} from './doctor.ts';
import {WizardError} from './errors.ts';
import {answers, HttpError, requestJson} from './http.ts';
import {info, sleep} from './output.ts';
import {portInUse} from './ports.ts';
import {docker} from './process.ts';
import {composeArgs, prepareQuickstart} from './quickstart.ts';
import {
  apiBase,
  distrUrl,
  home,
  loadState,
  newState,
  paths,
  readOptional,
  saveState,
  writePrivateFile,
  type State,
} from './state.ts';
import {showTelemetryNotice, track} from './telemetry.ts';
import {isAtLeast, parseVersion} from './version.ts';

const pullAttempts = 4;

export type UpOptions = {
  port?: number;
  image?: string;
  quickstartDir?: string;
};

type Credentials = {email: string; password: string};

async function distrRunning(): Promise<boolean> {
  const containers = await docker([
    'ps',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${distrProject}`,
    '--filter',
    'label=com.docker.compose.service=distr',
  ]);
  return containers.stdout.trim() !== '';
}

async function prepare(options: UpOptions): Promise<{state: State; envChanged: boolean}> {
  const composeVersion = await requireDocker();
  const state = (await loadState()) ?? newState();
  if (options.port !== undefined) {
    state.port = options.port;
  }
  if (options.image !== undefined) {
    state.image = options.image || undefined;
  }
  if (options.quickstartDir !== undefined) {
    state.quickstartDir = options.quickstartDir ? resolve(options.quickstartDir) : undefined;
  }
  await saveState(state);
  await showTelemetryNotice(state);

  if (!(await distrRunning())) {
    for (const port of [state.port, registryPort]) {
      if (await portInUse(port)) {
        const hint = port === registryPort ? 'Free it' : 'Free it or pass --port with a free port';
        throw new WizardError(
          `Port ${port} is in use. ${hint}, then run distr-wizard up again.`,
          'preflight',
          'port_in_use'
        );
      }
    }
  }

  const {composeFile, envChanged} = await prepareQuickstart(state);
  const version = parseVersion(composeVersion);
  if (composeFile.includes('pre_start:') && version && !isAtLeast(version, [5, 3, 0])) {
    throw new WizardError(
      `This Distr quickstart needs Docker Compose 5.3 or later, ${composeVersion} is installed.`,
      'preflight',
      'compose_outdated'
    );
  }
  return {state, envChanged};
}

async function images(): Promise<string[]> {
  const config = await docker([...composeArgs(), 'config', '--images']);
  if (config.code !== 0) {
    throw new WizardError(`Could not read the images of the quickstart: ${config.stderr.trim()}`, 'pull');
  }
  const images = new Set(config.stdout.split('\n').filter(Boolean));
  // Pulling the controller images up front keeps the first deployment from waiting on them.
  const tag = [...images].map((image) => /^ghcr\.io\/distr-sh\/distr-(?:ce|ee):(.+)$/.exec(image)?.[1]).find(Boolean);
  if (tag) {
    images.add(`ghcr.io/distr-sh/distr/docker-controller:${tag}`);
    images.add(`ghcr.io/distr-sh/distr/docker-autoheal:${tag}`);
  }
  return [...images].sort();
}

async function pullImages(): Promise<void> {
  const all = await images();
  const missing: string[] = [];
  for (const image of all) {
    if ((await docker(['image', 'inspect', image])).code !== 0) {
      missing.push(image);
    }
  }
  if (missing.length > 0) {
    info(`Downloading ${missing.length} of ${all.length} images. The first run downloads about 1.5 GB.`);
    info('If this is interrupted or times out, run the same command again: finished layers are kept.');
  }
  for (const [index, image] of missing.entries()) {
    for (let attempt = 1; ; attempt++) {
      info(`[${index + 1}/${missing.length}] downloading ${image} (attempt ${attempt} of ${pullAttempts})`);
      if ((await docker(['pull', image], {show: true})).code === 0) {
        break;
      } else if (attempt === pullAttempts) {
        throw new WizardError(
          `Could not download ${image} after ${pullAttempts} attempts. Check the network and run the same command again.`,
          'pull',
          'image_pull_failed'
        );
      }
      await sleep(attempt * 5_000);
    }
  }
}

async function startDistr(state: State, envChanged: boolean): Promise<void> {
  info(`Starting Distr as the Docker Compose project ${distrProject}`);
  const existed = (await docker([...composeArgs(), 'ps', '-aq', 'distr'])).stdout.trim() !== '';
  if ((await docker([...composeArgs(), 'up', '-d', '--remove-orphans', '--pull', 'never'], {show: true})).code !== 0) {
    throw new WizardError('docker compose up failed, see the output above.', 'start_distr', 'distr_not_ready');
  }
  // Recreating a container that was just created would interrupt its first database migration.
  if (existed && envChanged) {
    await docker([...composeArgs(), 'up', '-d', '--force-recreate', '--no-deps', '--pull', 'never', 'distr'], {
      show: true,
    });
  }
  for (let second = 0; !(await answers(`${distrUrl(state)}/ready`)); second += 2) {
    if (second >= 180) {
      throw new WizardError(
        `Distr did not become ready within 3 minutes. Run distr-wizard diagnose.`,
        'start_distr',
        'distr_not_ready'
      );
    } else if (second > 0 && second % 20 === 0) {
      info(`Waiting for Distr to become ready (${second} seconds)`);
    }
    await sleep(2_000);
  }
}

async function login(base: string): Promise<string> {
  const content = await readOptional(paths.credentials);
  if (content !== undefined) {
    const {email, password} = JSON.parse(content) as Credentials;
    return (await requestJson<{token: string}>(`${base}/auth/login`, {method: 'POST', body: {email, password}})).token;
  }
  const password = randomBytes(12).toString('hex');
  await writePrivateFile(paths.credentials, `${JSON.stringify({email: adminEmail, password}, null, 2)}\n`);
  try {
    const body = {email: adminEmail, password, name: 'Local Admin', organizationName: 'Local Distr'};
    return (await requestJson<{token: string}>(`${base}/auth/register`, {method: 'POST', body})).token;
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) {
      throw new WizardError(
        'Distr keeps data of an earlier installation the wizard has no login for. Run distr-wizard down to start over.',
        'bootstrap'
      );
    }
    throw error;
  }
}

async function bootstrap(state: State): Promise<string> {
  const base = apiBase(state);
  let accessToken = (await readOptional(paths.token))?.trim();
  if (accessToken) {
    try {
      await requestJson(`${base}/context`, {accessToken});
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 401)) {
        throw error;
      }
      accessToken = undefined;
    }
  }
  if (!accessToken) {
    const bearer = await login(base);
    const created = await requestJson<{key: string}>(`${base}/settings/tokens`, {
      method: 'POST',
      bearer,
      body: {label: 'distr-wizard'},
    });
    accessToken = created.key;
    await writePrivateFile(paths.token, accessToken);
  }
  // Runs on every start, so an interrupted bootstrap still gets its registry slug.
  const organization = await requestJson<Record<string, unknown>>(`${base}/organization`, {accessToken});
  if (typeof organization.slug === 'string' && organization.slug) {
    return organization.slug;
  }
  await requestJson(`${base}/organization`, {method: 'PUT', accessToken, body: {...organization, slug: registrySlug}});
  return registrySlug;
}

export async function pull(options: UpOptions): Promise<void> {
  await prepare(options);
  await pullImages();
  info('All images are downloaded. Start Distr with distr-wizard up.');
}

export async function up(options: UpOptions) {
  const startedAt = Date.now();
  const {state, envChanged} = await prepare(options);
  await track(state, 'started');
  await pullImages();
  await startDistr(state, envChanged);
  const slug = await bootstrap(state);
  await track(state, 'distr_ready', {minutes: Math.ceil((Date.now() - startedAt) / 60_000)});
  info(`Distr is running at ${distrUrl(state)}. Log in as ${adminEmail}, the password is in ${paths.credentials}.`);
  return {
    distrUrl: distrUrl(state),
    apiBase: apiBase(state),
    login: {email: adminEmail, passwordFile: paths.credentials},
    tokenFile: paths.token,
    registry: {host: registryHost, slug, imagePrefix: `${registryHost}/${slug}`},
    home,
    next: 'distr-wizard hello',
  };
}
