import {apiBase} from './api.ts';
import {readHidden} from './hidden-input.ts';
import {saveToken, tokenFile} from './token-file.ts';

const tokenPrefix = 'distr-';

async function organizationName(base: string, token: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${base}/organization`, {
      headers: {Authorization: `AccessToken ${token}`},
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
    throw new Error(`cannot reach ${base}: ${cause}`);
  }
  if (response.status === 401) {
    throw new Error('Distr did not accept the token. Check that you copied all of it, or create a new one.');
  } else if (!response.ok) {
    throw new Error(`${base} answered ${response.status}: ${(await response.text()).trim()}`);
  }
  const organization = (await response.json()) as {name: string};
  return organization.name;
}

export async function login(env: NodeJS.ProcessEnv): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stderr.write('distr-wizard login asks for the token without showing it, so run it in your own terminal.\n');
    return 2;
  }
  const base = apiBase(env);
  process.stderr.write(`Create a personal access token at ${new URL('/settings/access-tokens', base).href}\n`);
  const token = (await readHidden('Access token: ', process.stdin, process.stderr))?.trim();
  if (token === undefined) {
    process.stderr.write('Cancelled, nothing was saved.\n');
    return 1;
  } else if (!token.startsWith(tokenPrefix)) {
    process.stderr.write(`This is not a Distr access token, which starts with "${tokenPrefix}".\n`);
    return 1;
  }
  try {
    const organization = await organizationName(base, token);
    const file = tokenFile(env);
    await saveToken(file, token);
    console.log(`Saved the access token for the organization "${organization}" to ${file}`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
