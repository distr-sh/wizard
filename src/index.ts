#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {doctor} from './doctor.ts';

const usage = `Usage: distr-wizard <command>

Commands:
  doctor    Check that this machine can run Distr locally, and that DISTR_TOKEN works when it is set

Options:
  -h, --help       Show this help
  -v, --version    Show the version

Environment:
  DISTR_TOKEN       Personal access token for the Distr API
  DISTR_API_BASE    Distr API base URL, https://app.distr.sh/api/v1 by default
`;

async function packageVersion(): Promise<string> {
  const content = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(content) as {version: string}).version;
}

async function main(): Promise<void> {
  const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {
      help: {type: 'boolean', short: 'h'},
      version: {type: 'boolean', short: 'v'},
    },
  });
  const [command] = positionals;

  if (values.version) {
    console.log(await packageVersion());
  } else if (values.help || command === undefined) {
    process.stdout.write(usage);
  } else if (command === 'doctor') {
    const results = await doctor(process.env);
    for (const result of results) {
      console.log(`${result.ok ? 'ok  ' : 'fail'}  ${result.name}: ${result.detail}`);
    }
    if (results.some((result) => !result.ok)) {
      process.exitCode = 1;
    }
  } else {
    process.stderr.write(`Unknown command "${command}"\n\n${usage}`);
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
