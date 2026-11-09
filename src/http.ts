export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type RequestOptions = {
  method?: string;
  accessToken?: string;
  bearer?: string;
  body?: unknown;
};

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {Accept: 'application/json'};
  if (options.accessToken) {
    headers.Authorization = `AccessToken ${options.accessToken}`;
  } else if (options.bearer) {
    headers.Authorization = `Bearer ${options.bearer}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(
      `${method} ${new URL(url).pathname} failed with ${response.status}: ${text.trim()}`,
      response.status
    );
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {signal: AbortSignal.timeout(30_000)});
  if (!response.ok) {
    throw new HttpError(`GET ${url} failed with ${response.status}`, response.status);
  }
  return response.text();
}

export async function answers(url: string, timeoutMilliseconds = 3_000): Promise<boolean> {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(timeoutMilliseconds)});
    return response.ok;
  } catch {
    return false;
  }
}
