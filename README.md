# Distr Wizard

Set up [Distr](https://distr.sh) and ship your first application to a self-managed customer, from your terminal or through an AI coding agent.

> [!NOTE]
> The wizard is at an early stage and offers a single command so far. It is not published to npm yet.

## Usage

Once published, run it with `npx`:

```shell
npx @distr-sh/wizard doctor
```

`doctor` checks that this machine can run the Distr quickstart (Docker Engine 29 or later with the Docker Compose plugin). When `DISTR_TOKEN` holds a [personal access token](https://distr.sh/docs/integrations/personal-access-token/), it also checks that the Distr API accepts it.

| Variable         | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `DISTR_TOKEN`    | Personal access token for the Distr API                      |
| `DISTR_API_BASE` | Distr API base URL, `https://app.distr.sh/api/v1` by default |

The exit code is 0 when every check passes, 1 when one fails and 2 for invalid usage.

## Principles

- The wizard installs nothing on your machine. It checks what is there and tells you what is missing.
- It talks to Distr through the [Distr SDK](https://distr.sh/docs/integrations/sdk/) and the public API only, so everything it does can also be done by hand.

## Development

The tools are pinned in `mise.toml`. Install them with [mise](https://mise.jdx.dev) and the dependencies with pnpm:

```shell
mise install
pnpm install
mise run build
node dist/index.js doctor
```

`mise run lint`, `mise run test` and `mise run format` check, test and format the code. The build bundles the CLI and its dependencies into `dist/index.js` with esbuild.

## License

[Apache 2.0](LICENSE)
