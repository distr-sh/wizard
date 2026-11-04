#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {deploy} from './deploy.ts';
import {doctor} from './doctor.ts';
import {UsageError, WizardError} from './errors.ts';
import {guide} from './guide.ts';
import {hello} from './hello.ts';
import {connect, diagnose, down, logs, registryLogin, status} from './manage.ts';
import {result} from './output.ts';
import {packageVersion} from './package.ts';
import {loadState, newState} from './state.ts';
import {trackBlocked} from './telemetry.ts';
import {pull, up, type UpOptions} from './up.ts';

const usage = `Usage: distr-wizard <command> [options]

Start Distr on this machine and ship an application to a test customer. Progress goes to stderr, results to stdout as
JSON. Run distr-wizard guide for the steps a coding agent follows.

Commands:
  doctor            Check that this machine can run Distr, and that DISTR_TOKEN works when it is set
  up                Start Distr locally with an admin user, an API token and a registry
  pull              Only download the images up needs, safe to repeat after a timeout
  hello             Deploy Hello Distr to the test customer and wait until it is healthy
  deploy            Ship a Docker Compose application to the test customer
  status            Show Distr and the deployments of the test customer
  logs              Print the logs Distr received for an application (--app, --limit)
  connect           Start the Distr controller of the test customer again with a fresh manifest
  registry-login    Log Docker in to the local Distr registry
  diagnose          Print diagnostics with every secret redacted
  down              Remove Distr, its controllers and the applications they deployed
  guide             Print the onboarding guide for coding agents

Options for up and pull:
  --port <port>         Port of Distr, 8080 by default
  --image <image>       Run another Distr image, for example one built from a Distr checkout
  --quickstart <dir>    Use the quickstart in a Distr checkout (deploy/docker/quickstart)

Options for deploy:
  --name <name>             Name of the application
  --app-version <version>   Name of the new version, such as 1.0.0
  --compose <file>          Docker Compose file
  --template <file>         Environment template customers start from
  --env <file>              Environment of the test customer's deployment
  --secret <key>            Create a secret with a random value for the test customer, repeatable
  --link <url>              Link to the running application

Environment:
  DISTR_WIZARD_HOME   Where the wizard keeps its state, ~/.distr/local by default
  DO_NOT_TRACK=1      Turn off the anonymous usage events
  DISTR_TOKEN         Personal access token doctor checks
  DISTR_API_BASE      Distr API base URL doctor checks, https://app.distr.sh/api/v1 by default

  -h, --help       Show this help
  -v, --version    Show the version
`;

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 8585) {
    throw new UsageError('--port takes a port number other than 8585, which the registry uses.');
  }
  return port;
}

async function main(): Promise<void> {
  const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {
      help: {type: 'boolean', short: 'h'},
      version: {type: 'boolean', short: 'v'},
      port: {type: 'string'},
      image: {type: 'string'},
      quickstart: {type: 'string'},
      name: {type: 'string'},
      'app-version': {type: 'string'},
      compose: {type: 'string'},
      template: {type: 'string'},
      env: {type: 'string'},
      secret: {type: 'string', multiple: true},
      link: {type: 'string'},
      app: {type: 'string'},
      limit: {type: 'string'},
    },
  });
  const [command] = positionals;
  const upOptions: UpOptions = {port: parsePort(values.port), image: values.image, quickstartDir: values.quickstart};

  if (values.version) {
    console.log(await packageVersion());
  } else if (values.help || command === undefined) {
    process.stdout.write(usage);
  } else if (command === 'doctor') {
    const results = await doctor(process.env);
    for (const check of results) {
      console.log(`${check.ok ? 'ok  ' : 'fail'}  ${check.name}: ${check.detail}`);
    }
    if (results.some((check) => !check.ok)) {
      process.exitCode = 1;
    }
  } else if (command === 'up') {
    result(await up(upOptions));
  } else if (command === 'pull') {
    await pull(upOptions);
  } else if (command === 'hello') {
    result(await hello());
  } else if (command === 'deploy') {
    result(
      await deploy({
        name: values.name,
        appVersion: values['app-version'],
        compose: values.compose,
        template: values.template,
        env: values.env,
        secrets: values.secret ?? [],
        link: values.link,
      })
    );
  } else if (command === 'status') {
    result(await status());
  } else if (command === 'logs') {
    await logs(values.app ?? 'hello-distr', Number(values.limit ?? 50));
  } else if (command === 'connect') {
    await connect();
  } else if (command === 'registry-login') {
    await registryLogin();
  } else if (command === 'diagnose') {
    await diagnose();
  } else if (command === 'down') {
    result(await down());
  } else if (command === 'guide') {
    process.stdout.write(guide);
  } else {
    throw new UsageError(`Unknown command "${command}".`);
  }
}

main().catch(async (error: unknown) => {
  if (error instanceof WizardError) {
    console.error(`error: ${error.message}`);
    await trackBlocked((await loadState()) ?? newState(), error);
    process.exitCode = 1;
  } else if (error instanceof UsageError || (error instanceof TypeError && 'code' in error)) {
    console.error(`error: ${error.message}\n\nRun distr-wizard --help for the commands and options.`);
    process.exitCode = 2;
  } else {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
});
