---
name: distr
description: >
  Onboards a project to Distr so it can be shipped to self-managed customers. Packages the application
  as a Docker Compose file or Helm chart, resolves its external dependencies, creates the application,
  a test customer and a deployment through the Distr API and checks that the deployment runs. Use when
  asked to onboard a project to Distr, to ship or distribute it to self-managed or on-premises customers
  with Distr, or when a deploy/distr/ directory exists.
metadata:
  author: distr-sh
  version: '0.1.0'
---

# Distr onboarding

[Distr](https://distr.sh) ships applications to customers who run them in their own environments. The vendor, the user you work for, manages applications, customers and deployments at `app.distr.sh`. Every customer environment runs a Distr Controller, which pulls the version the vendor deploys and reports status and logs back.

This skill takes a repository to a running deployment at a test customer on this machine, in eight phases:

1. Inspect the repository
2. Choose the packaging
3. Resolve the dependencies
4. Write and test the package locally
5. Get access to Distr
6. Create the application in Distr
7. Deploy to a test customer
8. Hand over

Work through them in order. Before you start, tell the user in two or three sentences what you are going to do. Ask wherever this skill says to ask, and keep everything else moving without asking.

The skill directory is the directory of this file. `references/` holds the details of each phase, `scripts/distr-api.sh` calls the Distr API and `assets/` holds the files you upload.

## Rules

- Never ask for the Distr access token in the chat, never print it and never write it anywhere. `scripts/distr-api.sh` reads it from the file `npx @distr-sh/wizard login` saves.
- Never print or commit passwords, API keys, the target secret or the connect URL. Generate a password inside the command that stores it as a Distr secret, and pipe the connect command straight into the shell.
- Never create a Distr account, and never touch billing or payment. The user signs up in the browser.
- Ask before you start containers, pull or push images, install anything or connect a controller.
- Only connect the controller of the test customer, on this machine. Real customers connect their own controllers from the customer portal.
- Write everything into `deploy/distr/`. Do not change the application's code or its existing deployment files unless the user agrees.
- Never replace a dependency with a different product, a hosted auth service with a self-hosted one for example, without asking.
- After five failed deploy attempts, stop and write `deploy/distr/BLOCKED.md` (see phase 8).

## 1. Inspect the repository

If `deploy/distr/distr.json` exists, an earlier run already created resources in Distr. Read it and continue from where that run stopped instead of creating anything twice.

Otherwise look for:

- Compose files (`compose.yaml`, `docker-compose.yml` and their variants, also under `deploy/`, `docker/` and `.docker/`), Helm charts (any `Chart.yaml`), Kubernetes manifests and Kustomize overlays.
- Dockerfiles, and how and where CI builds and publishes the images.
- Configuration: `.env.example`, environment variables the code reads, config files, ports and volumes.
- Services the code talks to: databases, caches, queues, object storage and hosted APIs such as auth, payments, email or LLM providers.
- A logo (`logo.svg`, `logo.png`, `favicon.*`, `assets/`, `public/`, `static/`, `.github/`) and screenshots (`screenshots/`, `docs/images/`, the images of the README).

Show the user a short summary: the services and their images, whether each image is public, the dependencies and the settings a customer would change.

## 2. Choose the packaging

- A Compose file or a Helm chart exists: use it. Copy it into `deploy/distr/` and adapt it, do not rewrite it.
- Neither exists: Docker Compose is the default, since it gets to a working deployment fastest and is the easiest for customers to run.
- Recommend Helm only when the application already runs on Kubernetes, has many services, needs horizontal scaling or high availability, or its customers require Kubernetes.

Tell the user your choice and why in one or two sentences and let them confirm it. Compose and Helm specifics are in `references/packaging.md`.

## 3. Resolve the dependencies

Sort every external dependency into one of two groups:

- **Can run in the stack:** PostgreSQL, MySQL, MongoDB, Redis, RabbitMQ, S3-compatible storage and similar.
- **Hosted service only:** WorkOS, Auth0, Clerk, Stripe, SendGrid, OpenAI and similar.

For the first group, ask the user once:

> Do your customers run everything on one machine, or do they bring their own database and storage?

- **One machine:** bundle the dependencies in the Compose file or the chart, so the application is self-contained. This suits less technical customers and proofs of concept.
- **Their own:** the customer configures each dependency through environment variables, with its credentials as Distr secrets. This suits experienced teams that run managed services such as Amazon RDS and S3.

Build only what the user answers. If they want both variants later, the second becomes its own application in Distr.

Hosted services are always configured through environment variables with their credentials as Distr secrets, whatever the answer. Ask whose account each one uses: the vendor's, with a key or tenant per customer that the vendor fills in, or the customer's own, which the customer fills in. Tell the user the application is then self-contained except for these services, so customers need outbound internet access to them and air-gapped customers cannot run it.

Only bring up the Distr infrastructure controller, which provisions cloud resources with OpenTofu, when the user asks for provisioning. It suits teams that already manage infrastructure with Terraform or OpenTofu at scale.

How to write each variant is in `references/packaging.md#dependencies`.

## 4. Write and test the package locally

Write into `deploy/distr/`:

| File                                               | Content                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `compose.yaml` or `chart/`                         | The package                                                                                   |
| `env.template` (Compose) or `values.template.yaml` | What a customer fills in, with a comment per setting and every secret as `{{ .Secrets.KEY }}` |
| `test-customer.env` or `test-customer-values.yaml` | The configuration of the test customer, with its secrets as `{{ .Secrets.KEY }}` too          |
| `distr.json`                                       | The IDs of what you create in Distr, never a secret                                           |

The customer's controller has to be able to pull every image. Public images work as they are. Images built from this repository have to be pushed to a registry, the Distr registry by default (`references/api.md#registry`).

Ask, then test the package on this machine before Distr is involved, with a filled-in copy of `test-customer.env` outside the repository (`references/packaging.md#local-test`): `docker compose config`, then `up -d`, check that the application answers, then `down -v`. For Helm run `helm lint` and `helm template`. Fix what fails before you continue.

## 5. Get access to Distr

Check for a saved token and verify it with `references/api.md#check-access`. If there is none or Distr rejects it, tell the user:

> 1. Sign up at https://app.distr.sh/register?utm_source=skill, unless you already have an account.
> 2. In your own terminal, run `npx @distr-sh/wizard login`. It shows where to create a personal access token and saves it without showing it here.
> 3. Tell me when you are done.

Then wait. Never ask the user to paste the token into the chat.

## 6. Create the application in Distr

Follow the recipes in `references/api.md`, and write every ID into `deploy/distr/distr.json` as soon as you have it:

1. Push the images built from this repository, after asking (`#registry`).
2. Create the application (`#application`). Use the `semver` versioning strategy when the versions are semantic versions, `chronological` otherwise.
3. Create the first version with the package files (`#version`).
4. Give the application its images (`#images`): the logo as its image and a screenshot of the product as its title image, which customers see on their home page. Ask the user when you find neither.
5. Brand the vendor portal (`#branding`) with the product's name, a one-line description from the README and the logo. When branding is already set, show the user what you would change and ask first.

## 7. Deploy to a test customer

A Helm deployment needs a Kubernetes cluster on this machine, so check before you create anything in this phase. When `kubectl config current-context` names a local cluster such as kind, k3d, minikube, Docker Desktop or OrbStack, ask whether to use it. Otherwise skip to phase 8 and explain that the chart is in Distr and ready to deploy.

Follow `references/api.md`:

1. Create the customer "Test customer" with `assets/test-customer-logo.png` as its logo (`#customer`).
2. Store the secrets of the test customer (`#secrets`). Generate passwords inside the command. For a hosted service, ask the user to enter its key on the customer's secrets page in Distr, since it must not pass through the chat.
3. Create a deployment target for the test customer (`#target`) and the deployment (`#deployment`).
4. Ask, then connect the controller on this machine (`#connect`).
5. Wait until the deployment is healthy, check that the application answers and read its logs in Distr (`#status`).

When a deployment fails, follow `references/troubleshooting.md`.

## 8. Hand over

Write `deploy/distr/HANDOFF.md`:

- What runs where, with links to the application (`https://app.distr.sh/applications/<id>`), the test customer's deployment (`https://app.distr.sh/deployments/<target id>`) and the vendor portal branding (`https://app.distr.sh/branding`).
- Every file you wrote and what is in it.
- How to clean up: undeploy and delete the test target in Distr, then remove the controller. A Docker controller goes with `docker stop distr-controller-1 && docker rm distr-controller-1`, a Kubernetes one with `kubectl delete -n <namespace> deployment/distr-controller secrets/distr-controller-auth configmaps/distr-controller-env serviceaccounts/distr-controller clusterrolebindings/distr-controller-<namespace>`.
- The next steps: invite a first real customer to the customer portal, publish new versions from CI with the [Distr GitHub Action](https://distr.sh/docs/integrations/github-actions/) and [book an onboarding call](https://cal.glasskube.com/team/gk/distr-onboarding).

When you are blocked, write `deploy/distr/BLOCKED.md` instead: what failed, the error, what you tried and what the user can do next, and offer the [onboarding call](https://cal.glasskube.com/team/gk/distr-onboarding).

End with a short summary in the chat and offer to commit `deploy/distr/`.
