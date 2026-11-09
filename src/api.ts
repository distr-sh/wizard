const defaultApiBase = 'https://app.distr.sh/api/v1';

export function apiBase(env: NodeJS.ProcessEnv): string {
  return (env.DISTR_API_BASE || defaultApiBase).replace(/\/+$/, '');
}
