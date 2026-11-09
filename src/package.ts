import {readFile} from 'node:fs/promises';

let version: Promise<string> | undefined;

export function packageVersion(): Promise<string> {
  version ??= readFile(new URL('../package.json', import.meta.url), 'utf8').then(
    (content) => (JSON.parse(content) as {version: string}).version
  );
  return version;
}
