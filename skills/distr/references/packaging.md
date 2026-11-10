# Packaging

## Compose

Start from the existing Compose file when there is one, and change only what a customer environment needs:

- Reference every image by a registry path and a pinned tag. Replace `build:` with the image you push (`api.md#registry`), and never use `latest`, since a customer has to get exactly the version you deployed.
- Turn every setting a customer changes into a variable: `${PUBLIC_URL:?set PUBLIC_URL}` for required ones, `${LOG_LEVEL:-info}` for ones with a default. The controller passes the deployment's environment file to `docker compose --env-file` and writes it as `.env` next to the Compose file, so `env_file: [.env]` hands all of it to a service.
- Variables are only interpolated into the Compose file, not passed into containers. List what each service needs under `environment`, or use `env_file: [.env]` where a service needs everything.
- Store data in named volumes, never in bind mounts to paths on the host, which the customer's machine does not have.
- Give every long-running service `restart: unless-stopped` and a `healthcheck`, so Distr can report whether it is healthy.
- Publish only the ports users reach, and make them configurable: `${HTTP_PORT:-8080}:8080`.
- Keep development-only services such as mail catchers, admin UIs and hot reload out of the package.

`env.template` lists every variable with a comment saying what it does, the default and whether it is required. Reference secrets as `{{ .Secrets.KEY }}` rather than values, so customers fill in the key in Distr and never write the value into the file:

```dotenv
# The URL users open, without a trailing slash. Required.
PUBLIC_URL=https://app.example.com
# The database password. Stored as a Distr secret.
POSTGRES_PASSWORD={{ .Secrets.POSTGRES_PASSWORD }}
```

`test-customer.env` is the same file filled in for this machine, for example `PUBLIC_URL=http://localhost:8080`.

### Local test

Distr fills in the `{{ .Secrets.KEY }}` references at deploy time, so `docker compose` cannot read `test-customer.env` as it is. Test with a copy outside the repository that has a generated value in place of every reference, and delete it afterwards:

```sh
env=$(mktemp)
sed -E "s/\{\{ *\.Secrets\.[A-Za-z0-9_]+ *\}\}/$(openssl rand -hex 24)/g" deploy/distr/test-customer.env >"$env"
docker compose -f deploy/distr/compose.yaml --env-file "$env" config >/dev/null
docker compose -f deploy/distr/compose.yaml --env-file "$env" up -d --wait
# check that the application answers, then:
docker compose -f deploy/distr/compose.yaml --env-file "$env" down -v
rm -f "$env"
```

## Helm

Start from the existing chart when there is one. Otherwise write a chart only when phase 2 chose Helm, and keep it small: a Deployment and a Service per component, an optional Ingress, and a Secret for credentials.

- Put every setting a customer changes in `values.yaml`, with a comment per value.
- Reference images by a registry path and a pinned tag, as for Compose.
- Reference secrets in the values as `{{ .Secrets.KEY }}`, for example `postgresql: {auth: {password: '{{ .Secrets.POSTGRES_PASSWORD }}'}}`. Distr renders them into the values before it installs the chart.
- `values.template.yaml` holds what a customer fills in, `test-customer-values.yaml` the same for the local cluster.
- Check the chart with `helm lint` and `helm template`.

Without a local cluster, the chart goes as far as a version in Distr (phase 6). Say so in `HANDOFF.md`.

## Dependencies

### Bundled

The dependency runs as a service of the stack:

- Use the official image with a pinned tag, `postgres:17` for example.
- Store its data in a named volume.
- Give it a healthcheck, and start the application only once it is healthy (`depends_on` with `condition: service_healthy`).
- Generate its password as a Distr secret and pass the same secret to the dependency and the application.
- Do not publish its port to the host.

In a chart, prefer a well-known subchart and expose its switch, `postgresql.enabled` for example, only when the chart already has one.

### Provided by the customer

The customer runs the dependency, Amazon RDS or S3 for example, and configures the connection:

- Remove the service from the stack.
- Read the connection from variables: a URL (`DATABASE_URL`), or host, port, user and database, plus TLS settings where the client supports them.
- Keep credentials as `{{ .Secrets.KEY }}` references in the template, and document in it which version and which permissions the application needs.
- For the test customer, run the dependency on this machine outside the package, `docker run` a PostgreSQL for example after asking, and point the test environment at it via `host.docker.internal`. Docker Desktop resolves that name on its own, Linux only with `extra_hosts: ['host.docker.internal:host-gateway']` on the services that connect, so add it to them. It does no harm on customer machines.

### Hosted services

A service that only exists as SaaS, such as WorkOS, Auth0, Clerk, Stripe, SendGrid or OpenAI, is configured through variables in every variant, with its credentials as Distr secrets:

- Add its settings to the template with a comment saying where they come from: the vendor's account (with a key or tenant per customer) or the customer's own.
- Leave callback and redirect URLs configurable, since they depend on the customer's domain, and say in the template that they have to be registered with the service.
- Note in `HANDOFF.md` that customers need outbound access to the service and that air-gapped customers cannot run the application.
- For the test customer, ask the user for a test or sandbox key, entered on the customer's secrets page in Distr. Without one, stop before the deployment and write `BLOCKED.md` naming the missing key, rather than deploying something that cannot start.

### Infrastructure controller

The Distr infrastructure controller provisions cloud resources with OpenTofu. Only bring it up when the user asks for provisioning, and point them to https://distr.sh/docs/controllers/infrastructure-controllers/ instead of setting it up in this onboarding.
