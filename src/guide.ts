export const guide = `# Ship an application with Distr

Distr distributes applications to customers who run them in their own infrastructure. A vendor packages the
application as Docker Compose, and Distr adds a registry, a customer portal and Distr controllers that install it in
each customer environment and report status and logs back.

This guide is for coding agents. The wizard does the mechanical steps, you do the packaging. Explain each step to the
user in a sentence. Every command prints progress on stderr and its result as JSON on stdout.

## Ground rules

- Ask before you start containers or a Distr controller. distr-wizard up runs about five containers on ports 8080 and
  8585 with 4 GB of memory, distr-wizard hello runs Hello Distr on ports 80 and 443. In a run nobody can answer, go ahead.
- The wizard installs nothing. When it reports something missing or outdated, stop and tell the user what to fix.
- Write the packaging and the handoff into deploy/distr/ in the repository, so they can be reviewed and committed.
  Do not change application code unless the user asks.
- Never print, commit or write the API token, a password or a connect URL into a file. The wizard keeps them in its
  home directory, and distr-wizard diagnose redacts them.
- Never create a Distr Cloud account. Access to Distr Cloud and Enterprise licenses comes through the links at the end.

## 1. Start Distr and prove the loop

    distr-wizard up
    distr-wizard hello

up downloads about 1.5 GB the first time. When your tool times out, run distr-wizard pull until it finishes and then
distr-wizard up again, every run resumes. hello deploys Hello Distr to the test customer and waits until it is healthy,
answers on http://localhost and its logs reached Distr. Skip it when ports 80 or 443 are taken.

## 2. Package the application

Read the repository: compose files, Dockerfiles, the services it needs, environment variables, ports and volumes.

- Write deploy/distr/docker-compose.yaml. Every service needs an image, because Distr cannot build. Build the images
  and push them to the local registry:

      distr-wizard registry-login
      docker build -t localhost:8585/local/<name>:<tag> .
      docker push localhost:8585/local/<name>:<tag>

  Tags in the registry cannot be overwritten, so push a new tag for every change.
- Put settings a customer changes into deploy/distr/env.template as KEY=value lines and use them as \${KEY}.
- Write the test customer's values into deploy/distr/deployment.env. Reference a password as
  {{ .Secrets.<KEY> }} and pass --secret <KEY>, which stores a random value as a secret of the test customer.
- Prove it runs before Distr is involved:
  docker compose -p distr-app-test -f deploy/distr/docker-compose.yaml --env-file deploy/distr/env.template up -d,
  check the containers, then the same command with down -v.

## 3. Ship it to the test customer

    distr-wizard deploy --name <app> --app-version 1.0.0 \\
      --compose deploy/distr/docker-compose.yaml --template deploy/distr/env.template \\
      --env deploy/distr/deployment.env --secret <KEY>

deploy creates the application and the version, deploys it to the test customer and waits until it is healthy, or
running for services without a healthcheck. Hello Distr holds ports 80 and 443; free them in the Distr web interface
when your application needs them. When the deployment fails, read distr-wizard logs --app <app>, fix the packaging and
deploy again with the next --app-version. A version cannot change. Stop after five attempts and go to Blocked.

## 4. Hand over

Write deploy/distr/HANDOFF.md and print it. It covers what runs where (Distr at the distrUrl from distr-wizard status,
the login in the wizard's credentials file, the test customer and the application), what you created and every file you
wrote, how to stop everything (distr-wizard down) and the next steps:

- Keep self-hosting: the Community Edition stays free, an Enterprise license adds license keys, RBAC, alerts and support
  bundles: https://distr.sh/onboarding/?interest=enterprise-license&utm_source=wizard&utm_medium=cli
- Or move to Distr Cloud with a free 30 day trial: https://distr.sh/onboarding/?interest=cloud-trial&utm_source=wizard&utm_medium=cli
- Then publish new versions from CI with the distr-sh/distr-create-version-action GitHub Action.

## Blocked

When something only a person can fix stops you, write deploy/distr/BLOCKED.md with what failed, what you tried and what
you need, and print it together with the output of distr-wizard diagnose. The Distr team helps at
https://distr.sh/onboarding/?interest=help&utm_source=wizard&utm_medium=cli. A clean Blocked is a good ending.
`;
