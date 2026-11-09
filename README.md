# Distr Wizard

Set up [Distr](https://distr.sh) and ship your first application to a self-managed customer, from your terminal or through an AI coding agent.

> [!NOTE]
> The wizard is at an early stage and not published to npm yet. It supports Docker Compose applications on this machine; Kubernetes follows.

## Usage

Once published, run it with `npx`:

```shell
npx @distr-sh/wizard up
npx @distr-sh/wizard hello
```

`up` starts the Distr Community Edition with Docker Compose on this machine, with an admin user, an API token and the Distr registry. `hello` deploys the [Hello Distr](https://github.com/distr-sh/hello-distr) demo to a test customer through a Distr controller and waits until it is healthy and its logs reached Distr. Then `deploy` ships your own application the same way.

Coding agents start with `distr-wizard guide`, which prints the steps they follow to package and ship an application.

| Command          | Description                                                                         |
| ---------------- | ----------------------------------------------------------------------------------- |
| `doctor`         | Checks that this machine can run Distr, and that `DISTR_TOKEN` works when it is set |
| `up`             | Starts Distr locally                                                                |
| `pull`           | Only downloads the images `up` needs, safe to repeat after a timeout                |
| `hello`          | Deploys Hello Distr to the test customer                                            |
| `deploy`         | Ships a Docker Compose application to the test customer                             |
| `status`         | Shows Distr and the deployments of the test customer                                |
| `logs`           | Prints the logs Distr received for an application                                   |
| `connect`        | Starts the Distr controller of the test customer again                              |
| `registry-login` | Logs Docker in to the local Distr registry                                          |
| `diagnose`       | Prints diagnostics with every secret redacted                                       |
| `down`           | Removes Distr, its controllers and the applications they deployed                   |
| `guide`          | Prints the onboarding guide for coding agents                                       |

Run `distr-wizard --help` for the options. Progress goes to stderr and results to stdout as JSON. The exit code is 0 on success, 1 when a step fails and 2 for invalid usage.

The wizard keeps its state, the admin password and the API token in `~/.distr/local`, or in `DISTR_WIZARD_HOME` when it is set. `down` removes that directory together with everything the wizard started.

| Variable            | Description                                                               |
| ------------------- | ------------------------------------------------------------------------- |
| `DISTR_WIZARD_HOME` | Where the wizard keeps its state, `~/.distr/local` by default             |
| `DISTR_TOKEN`       | Personal access token `doctor` checks against the Distr API               |
| `DISTR_API_BASE`    | Distr API base URL for `doctor`, `https://app.distr.sh/api/v1` by default |
| `DO_NOT_TRACK`      | Set to `1` to turn off the anonymous usage events                         |

## Telemetry

The wizard sends anonymous usage events to the Distr team: which step finished or failed, the versions of the wizard and Distr, the operating system and which coding agent ran it. It sends no names, paths, hostnames or application data, and identifies an installation by a random ID kept in its state. Set `DO_NOT_TRACK=1` or `DISTR_TELEMETRY=0` to turn it off.

## Principles

- The wizard installs nothing on your machine. It checks what is there and tells you what is missing.
- It talks to Distr through the [Distr SDK](https://distr.sh/docs/integrations/sdk/) and the public API only, so everything it does can also be done by hand.
- It never prints a token, a password or the connect URL of a Distr controller.

## Development

The tools are pinned in `mise.toml`. Install them with [mise](https://mise.jdx.dev) and the dependencies with pnpm:

```shell
mise install
pnpm install
mise run build
node dist/index.js doctor
```

`mise run lint`, `mise run test` and `mise run format` check, test and format the code. The build bundles the CLI and its dependencies into `dist/index.js` with esbuild.

To run against unreleased Distr changes, point `up` at a Distr checkout and an image built from it:

```shell
node dist/index.js up --quickstart ../distr/deploy/docker/quickstart --image distr-ce:dev
```

## License

[Apache 2.0](LICENSE)
