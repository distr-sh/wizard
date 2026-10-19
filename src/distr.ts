import {Client, DistrService} from '@distr-sh/distr-sdk';
import {WizardError} from './errors.ts';
import {answers, requestJson} from './http.ts';
import {apiBase, distrUrl, paths, readOptional, type State} from './state.ts';

export type CustomerOrganization = {
  id: string;
  name: string;
};

export type Secret = {
  id: string;
  key: string;
  customerOrganizationId?: string;
};

export type LogRecord = {
  resource: string;
  timestamp: string;
  body: string;
};

/**
 * The local Distr, reached through the Distr SDK where it covers an endpoint and through the REST API where it does
 * not yet (customer organizations, secrets and deployment logs).
 */
export class LocalDistr {
  readonly client: Client;
  readonly service: DistrService;
  private readonly base: string;
  private readonly token: string;

  private constructor(base: string, token: string) {
    this.base = base;
    this.token = token;
    this.client = new Client({apiBase: base, apiKey: token});
    this.service = new DistrService({apiBase: base, apiKey: token});
  }

  static async open(state: State): Promise<LocalDistr> {
    const token = (await readOptional(paths.token))?.trim();
    if (!token) {
      throw new WizardError('Distr is not set up on this machine yet. Run distr-wizard up first.', 'connect');
    }
    if (!(await answers(`${distrUrl(state)}/ready`))) {
      throw new WizardError(
        `Distr does not answer at ${distrUrl(state)}. Start it with distr-wizard up.`,
        'connect',
        'distr_not_ready'
      );
    }
    return new LocalDistr(apiBase(state), token);
  }

  private api<T>(method: string, path: string, body?: unknown): Promise<T> {
    return requestJson<T>(`${this.base}/${path}`, {method, accessToken: this.token, body});
  }

  customerOrganizations(): Promise<CustomerOrganization[]> {
    return this.api('GET', 'customer-organizations');
  }

  createCustomerOrganization(name: string): Promise<CustomerOrganization> {
    return this.api('POST', 'customer-organizations', {name});
  }

  secrets(): Promise<Secret[]> {
    return this.api('GET', 'secrets');
  }

  createSecret(key: string, value: string, customerOrganizationId: string): Promise<Secret> {
    return this.api('POST', 'secrets', {key, value, customerOrganizationId});
  }

  async logResources(deploymentId: string): Promise<string[]> {
    const resources = await this.api<{active: string[] | null}>('GET', `deployments/${deploymentId}/logs/resources`);
    return resources.active ?? [];
  }

  logs(deploymentId: string, resource: string, limit: number): Promise<LogRecord[]> {
    const query = new URLSearchParams({resource, limit: String(limit)});
    return this.api('GET', `deployments/${deploymentId}/logs?${query}`);
  }
}
