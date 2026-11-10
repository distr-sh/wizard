# Troubleshooting

Count every rollout you send after a failure. After five, stop and write `deploy/distr/BLOCKED.md`.

## The controller does not connect

`reportedControllerVersionId` stays null for more than two minutes.

- Check that the container runs: `docker ps -a --filter name=distr-controller` and `docker logs distr-controller-1 --tail 50`.
- `path / is mounted on / but it is not a shared or slave mount` when connecting: metrics are enabled on a macOS target. Turn them off with `PUT /deployment-targets/<id>` (`metricsEnabled: false`), remove the controller with `docker rm -f distr-controller-1 distr-autoheal-1` and connect again.
- `401` or `invalid target secret` in its logs: request access again (`api.md#connect`), which issues a new secret.
- Connection errors: the machine needs outbound HTTPS to `app.distr.sh` and `registry.distr.sh`. A proxy or VPN may block them, so ask the user.

## The deployment stays `progressing`

The controller is pulling images, which can take a few minutes. After ten minutes the controller reports `error`.

## The deployment is in `error`

Read `currentStatus.message` and the logs (`api.md#status`), then fix the cause:

| Message or log                                         | Cause and fix                                                                                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pull access denied`, `manifest unknown`, `not found`  | The image is private or the tag does not exist. Push it to the Distr registry, or fix the tag in a new version                                  |
| `no matching manifest for linux/amd64`                 | The image was built for ARM only. Rebuild for both platforms and push under a new tag                                                           |
| `required variable ... is missing a value`             | A variable is missing from `test-customer.env`. Add it and roll out again                                                                       |
| `template execution error`, `map has no entry for key` | A `{{ .Secrets.KEY }}` has no secret for the test customer, which Distr can also answer to the deployment request. Create it (`api.md#secrets`) |
| `port is already allocated`, `address already in use`  | Another process uses the port. Change the port in `test-customer.env` and roll out again                                                        |
| The container restarts, the healthcheck fails          | Read the logs of that service. The application usually logs why it cannot start, a missing setting for example                                  |

To roll out a fix:

- A change to the environment file needs a new deployment request with `deploymentId` set.
- A change to the Compose file or the chart needs a new version (`api.md#version`) and a deployment request with the new `applicationVersionId`. A version name can only be used once.

## The application does not answer

The deployment is healthy, but `curl` fails:

- Check which ports the containers publish: `docker ps --filter label=com.docker.compose.project`. Every deployment runs as the Compose project `distr-<short deployment id>`.
- `PUBLIC_URL` or a similar setting may point elsewhere, which makes the application redirect.

## Distr rejects a request

The error says why and is meant for the user. Common ones:

- `401`: the token expired or was deleted. Ask the user to run `npx @distr-sh/wizard login` again.
- `403`: the token's role cannot do this, or the plan does not include the feature. Tell the user which action failed.
- A limit on customers or deployments: the trial allows fewer than paid plans. Show the user the message and stop.
