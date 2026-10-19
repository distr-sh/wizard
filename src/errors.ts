export type Step = 'preflight' | 'pull' | 'start_distr' | 'bootstrap' | 'connect' | 'deploy' | 'down';

export type Blocker =
  | 'docker_missing'
  | 'docker_outdated'
  | 'compose_outdated'
  | 'port_in_use'
  | 'image_pull_failed'
  | 'distr_not_ready'
  | 'controller_conflict'
  | 'controller_not_connecting'
  | 'deployment_unhealthy'
  | 'other';

/** A failure the user or their coding agent can act on. Its message is printed without a stack trace. */
export class WizardError extends Error {
  readonly step: Step;
  readonly blocker: Blocker;

  constructor(message: string, step: Step, blocker: Blocker = 'other') {
    super(message);
    this.step = step;
    this.blocker = blocker;
  }
}

export class UsageError extends Error {}
