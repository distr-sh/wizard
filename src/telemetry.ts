import {distrVersion} from './constants.ts';
import type {WizardError} from './errors.ts';
import {info} from './output.ts';
import {packageVersion} from './package.ts';
import {saveState, type State} from './state.ts';

// A PostHog project key only allows sending events, so it is public by design.
const projectKey = 'phc_kT9cJBgrQwRx9ayg0PUQkukLFowbTfN47jQuWqScglR';

type Properties = Record<string, string | number | boolean | object>;

export function telemetryEnabled(): boolean {
  return process.env.DO_NOT_TRACK !== '1' && process.env.DISTR_TELEMETRY !== '0';
}

export async function showTelemetryNotice(state: State): Promise<void> {
  if (telemetryEnabled() && !state.telemetryNoticeShown) {
    info(
      'The wizard sends anonymous usage events without application, repository or personal data. ' +
        'Turn them off with DO_NOT_TRACK=1.'
    );
    state.telemetryNoticeShown = true;
    await saveState(state);
  }
}

export function detectClient(): string {
  const env = process.env;
  if (env.CLAUDECODE) {
    return 'claude-code';
  } else if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID) {
    return 'cursor';
  } else if (env.CODEX_SANDBOX || env.CODEX_MANAGED_BY_NPM) {
    return 'codex';
  } else if (env.GEMINI_CLI) {
    return 'gemini-cli';
  } else {
    return 'unknown';
  }
}

async function send(state: State, event: string, properties: Properties): Promise<void> {
  if (!telemetryEnabled()) {
    return;
  }
  const body = {
    api_key: projectKey,
    event,
    distinct_id: state.installationId,
    properties: {
      ...properties,
      wizard_version: await packageVersion(),
      distr_version: distrVersion,
      client: detectClient(),
      os: process.platform,
      arch: process.arch,
      $geoip_disable: true,
      $process_person_profile: false,
    },
  };
  try {
    await fetch(`${process.env.DISTR_TELEMETRY_URL || 'https://edge.distr.sh'}/i/v0/e/`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Usage events must never fail or slow down a command.
  }
}

export function track(
  state: State,
  name: 'started' | 'distr_ready' | 'deployed',
  properties: Properties = {}
): Promise<void> {
  return send(state, `wizard_${name}`, properties);
}

export function trackBlocked(state: State, error: WizardError): Promise<void> {
  return send(state, '$exception', {
    step: error.step,
    blocker: error.blocker,
    $exception_list: [
      {
        type: 'DistrWizardBlocked',
        value: `${error.blocker} at ${error.step}`,
        mechanism: {handled: true, synthetic: true},
      },
    ],
    $exception_fingerprint: `${error.step}:${error.blocker}`,
  });
}
