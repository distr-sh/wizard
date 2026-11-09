# Distr API recipes

Every recipe calls `scripts/distr-api.sh` of this skill, which adds the access token and the API base (`https://app.distr.sh/api/v1`, or `DISTR_API_BASE` when set). Define the shorthand at the start of every command, since each command may run in a new shell:

```sh
api() { sh <skill dir>/scripts/distr-api.sh "$@"; }
```

The recipes need `curl` and `jq`. Ask before you install `jq` when it is missing.

On an HTTP error the script exits with code 22 and prints the error Distr sent, which is written for the user: show it to them as it is. Exit code 3 means there is no saved token (phase 5).

The full API reference is the OpenAPI specification at `https://app.distr.sh/docs/openapi.json`. Read it when you need an endpoint or a field that is not covered here, but keep in mind that the fields `envFileData` and `valuesYaml` are base64, which the specification does not say.

Write every ID into `deploy/distr/distr.json` as soon as you have it:

```json
{
  "applicationId": "",
  "applicationVersionId": "",
  "customerOrganizationId": "",
  "deploymentTargetId": "",
  "deploymentId": ""
}
```

## Check access

```sh
api /organization | jq '{name, slug, subscriptionType}'
```

## Registry

Customers pull images built from this repository from the Distr registry at `registry.distr.sh/<slug>/<name>:<tag>`. The slug belongs to the organization. When `slug` is null, propose one derived from the organization name (lowercase letters, digits, `.`, `_` and `-`), ask the user and set it. The request replaces the whole organization, so it carries every other field over unchanged:

```sh
api /organization | jq --arg slug "<slug>" '{
  name, slug: $slug,
  dockerPreConnectScript, dockerPostConnectScript, dockerConnectScriptIsSudo,
  kubernetesPreConnectScript, kubernetesPostConnectScript, controllerImageRepository,
  artifactVersionMutable: (.features | index("artifact_version_mutable") != null),
  prePostScriptsEnabled: (.features | index("pre_post_scripts") != null)
}' | api /organization -X PUT -H 'Content-Type: application/json' -d @- | jq '{name, slug}'
```

Ask before you log in and push, then:

```sh
case "${XDG_CONFIG_HOME:-}" in /*) config_home=$XDG_CONFIG_HOME ;; *) config_home=$HOME/.config ;; esac
docker login registry.distr.sh -u - --password-stdin < "$config_home/distr/token"
docker build -t registry.distr.sh/<slug>/<name>:<version> <context>
docker push registry.distr.sh/<slug>/<name>:<version>
```

Tags are immutable by default, so push every new build under a new version. Build for `linux/amd64` as well when this machine is an ARM Mac (`docker buildx build --platform linux/amd64,linux/arm64 --push ...`), since most customers run x86 servers.

Customers authenticate their pulls automatically: the controller logs in to the Distr registry with its own credentials.

## Application

`type` is `docker` for Compose and `kubernetes` for Helm. `versioningStrategy` is `semver` or `chronological`.

```sh
api /applications -X POST -H 'Content-Type: application/json' \
  -d '{"name":"<product name>","type":"docker","versioningStrategy":"semver"}' | jq '{id, name}'
```

## Version

A Compose version carries the Compose file and the environment template. Every file part needs a YAML content type, the environment template included, and is limited to 100 KiB.

```sh
api /applications/<applicationId>/versions -X POST \
  -F 'applicationversion={"name":"<version>"}' \
  -F 'composefile=@deploy/distr/compose.yaml;type=application/yaml' \
  -F 'templatefile=@deploy/distr/env.template;type=application/yaml' | jq '{id, name}'
```

A Helm version references a chart in an OCI registry or a chart repository, with its default values and the values template:

```sh
helm package deploy/distr/chart -d /tmp
helm push /tmp/<chart>-<chart version>.tgz oci://registry.distr.sh/<slug>
api /applications/<applicationId>/versions -X POST \
  -F 'applicationversion={"name":"<version>","chartType":"oci","chartUrl":"oci://registry.distr.sh/<slug>/<chart>","chartVersion":"<chart version>"}' \
  -F 'valuesfile=@deploy/distr/chart/values.yaml;type=application/yaml' \
  -F 'templatefile=@deploy/distr/values.template.yaml;type=application/yaml' | jq '{id, name}'
```

`helm push` needs `helm registry login registry.distr.sh -u - --password-stdin < "$config_home/distr/token"` first. For a chart repository, use `"chartType":"repository"` with `chartName`, the repository URL as `chartUrl` and `chartVersion`.

## Images

Upload an image as a public file, at most 500 KiB. Convert SVG to PNG and shrink large images first, `sips -s format png -Z 1024 <in> --out <out>.png` on macOS, and ask before you install a tool for it elsewhere.

```sh
api /files -X POST -F 'file=@<path>;type=image/png' -F public=true | jq -r .
```

The answer is the file ID. Set the logo as the application's image and a screenshot as its title image:

```sh
api /applications/<applicationId>/image -X PATCH -H 'Content-Type: application/json' \
  -d '{"imageId":"<logo file id>"}' | jq '{id, imageUrl}'
api /applications/<applicationId>/title-image -X PATCH -H 'Content-Type: application/json' \
  -d '{"imageId":"<screenshot file id>"}' | jq '{id, titleImageUrl}'
```

## Branding

Read the current branding first. Distr answers 404 when none is set, which leaves `{}`:

```sh
current=$(api /organization/branding 2>/dev/null) || current='{}'
printf '%s' "$current" | jq '{title, description, logoImageId}'
```

Set the title, a one-line markdown description and the logo. The request replaces the branding, so it carries over the page title and the favicon:

```sh
printf '%s' "$current" |
  jq --arg title "<product name>" --arg description "<one line from the README>" --arg logo "<logo file id>" \
    '{title: $title, description: $description, logoImageId: $logo, pageTitle, faviconImageId}' |
  api /organization/branding -X PUT -H 'Content-Type: application/json' -d @- | jq '{title, logoImageId}'
```

## Customer

```sh
logo=$(api /files -X POST -F 'file=@<skill dir>/assets/test-customer-logo.png;type=image/png' -F public=true | jq -r .)
jq -n --arg logo "$logo" '{name: "Test customer", imageId: $logo}' |
  api /customer-organizations -X POST -H 'Content-Type: application/json' -d @- | jq '{id, name}'
```

## Secrets

Store each secret for the test customer. Generate a password inside the command, so it never appears in the chat:

```sh
jq -n --arg key POSTGRES_PASSWORD --arg value "$(openssl rand -hex 24)" --arg customer "<customerOrganizationId>" \
  '{key: $key, value: $value, customerOrganizationId: $customer}' |
  api /secrets -X POST -H 'Content-Type: application/json' -d @- | jq '{id, key}'
```

Keys start with a letter and contain only letters, digits and underscores. Reference them as `{{ .Secrets.POSTGRES_PASSWORD }}` in the environment file or the values. For the key of a hosted service, send the user to `https://app.distr.sh/customers/<customerOrganizationId>/secrets` to enter it themselves, then list the keys to confirm it is there:

```sh
api '/secrets' | jq '[.[] | select(.customerOrganizationId == "<customerOrganizationId>") | .key]'
```

## Target

Metrics stay off on macOS, since Docker Desktop does not support the host mount the controller needs for them:

```sh
jq -n --arg customer "<customerOrganizationId>" --arg os "$(uname -s)" '{
  name: "Test customer (this machine)", type: "docker", customerOrganizationId: $customer,
  deploymentLogsEnabled: true, metricsEnabled: ($os != "Darwin"), imageCleanupEnabled: true, autohealEnabled: false
}' | api /deployment-targets -X POST -H 'Content-Type: application/json' -d @- | jq '{id, name}'
```

For Helm use `type: "kubernetes"` with `namespace` and `scope: "namespace"`, and leave out `autohealEnabled`.

## Deployment

`envFileData` (Compose) and `valuesYaml` (Helm) are base64. The answer has no body.

```sh
jq -n --arg target "<deploymentTargetId>" --arg version "<applicationVersionId>" \
  --arg env "$(base64 < deploy/distr/test-customer.env | tr -d '\n')" \
  '{deploymentTargetId: $target, applicationVersionId: $version, dockerType: "compose", envFileData: $env}' |
  api /deployments -X PUT -H 'Content-Type: application/json' -d @-
```

For Helm, send `releaseName` and `valuesYaml` from `deploy/distr/test-customer-values.yaml` instead of `dockerType` and `envFileData`. To roll out a change, send the same request with `deploymentId` set.

Read the deployment ID from the target:

```sh
api /deployment-targets/<deploymentTargetId> | jq '.deployments[] | {id, applicationVersionName}'
```

## Connect

Ask before you connect. The connect command carries the target secret, so pipe it straight into the shell and never print it or the response:

```sh
api /deployment-targets/<deploymentTargetId>/access-request -X POST | jq -r .connectCommand | sh
```

The Docker controller starts as the container `distr-controller-1`. For Kubernetes the command applies the controller to the target's namespace with `kubectl`.

## Status

Poll every 15 seconds for up to 10 minutes. `reportedControllerVersionId` is set once the controller has connected, and the status of a deployment is `progressing`, `running`, `healthy` or `error`:

```sh
api /deployment-targets/<deploymentTargetId> |
  jq '{connected: (.reportedControllerVersionId != null), deployments: [.deployments[] | {id, status: .currentStatus.type, message: .currentStatus.message}]}'
```

Read the logs Distr collected, one resource (a Compose service) at a time:

```sh
api '/deployments/<deploymentId>/logs/resources' | jq .active
api '/deployments/<deploymentId>/logs?resource=<resource>&limit=100' | jq -r '.[] | "\(.timestamp) \(.body)"'
```

Then check that the application answers on this machine, for example with `curl -fsS http://localhost:<port>/`.
