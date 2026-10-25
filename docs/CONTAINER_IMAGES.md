# Releases and container images (GitHub Packages)

[Documentation index](README.md) · [VPS deployment](DEPLOYMENT_VPS.md) · [Docker deployment](DEPLOYMENT_DOCKER.md)

> The [Render](DEPLOYMENT_CLOUD.md) deployment builds from the
> repository itself and does not need these images. The
> [VPS installer](DEPLOYMENT_VPS.md), [Docker host](DEPLOYMENT_DOCKER.md) and
> [Helm](../charts/spaceworks-workspace/README.md) deployments can use them.

The `Release` workflow (`.github/workflows/release.yml`) runs after the
`Quality gate` succeeds for a push to `main`. It checks out that exact tested
commit and publishes two public images for `linux/amd64` and `linux/arm64`,
with these roles:

| Image | Dockerfile target | Roles (the container command) |
| --- | --- | --- |
| `ghcr.io/spaceworks-labs/spaceworks-workspace-backend` | `runner` | `node server.js` (default): the application and API. `migrate`: apply pending database migrations once and exit. `node dist/worker.js`: BullMQ consumers. `node dist/beat.js`: registry schedule reconciliation. `node docker/vps/<tool>.mjs`: the VPS operator tools (setup, SMTP and external-storage configuration, certificate renewal, super-admin recovery, preflight, checks, SMTP check, smoke test), run as root. |
| `ghcr.io/spaceworks-labs/spaceworks-workspace-frontend` | `frontend` | `node frontend/server.js`: the website alone (the `frontend/` workspace). It holds no database, Redis, storage or mail credentials and calls the backend through the authenticated gateway. |

Pull requests and forks' pull requests never publish.

## Versions and releases

`VERSION` holds the release series, such as `0.1.0`. Every published build is
tagged `<VERSION>-main.<run>.<commit>`, for example `0.1.0-main.42.a1b2c3d4e5f6`,
and `sha-<commit>`. The newest main build also gets the rolling tags `main`,
`latest` and its series (`0.1`).

A **GitHub Release** is published by the first green build on `main` of each
`VERSION` (whichever commit changed it, and even if an earlier build of that
commit failed), or when the workflow is run by hand on `main`
(**Actions → Release → Run workflow**). Later builds of the same `VERSION`
publish images only. Its tag is `v<version>` and its notes
list the images and the install command. It becomes the latest release. The
[VPS installer](DEPLOYMENT_VPS.md) installs and updates to the latest release,
so bumping `VERSION` is how a change reaches installations:

1. In a pull request to `dev`, change `VERSION` (for example `0.1.0` → `0.2.0`).
2. Merge `dev` into `main`. When the Quality gate passes, the Release workflow
   publishes the images and the release.
3. Installations update by rerunning the one-line installer and choosing
   **Update**.

Running the workflow by hand on any other branch publishes a **pre-release**
(`<VERSION>-<branch>.<run>.<commit>`) that is never marked latest. Test it on a
disposable server with `curl … | bash -s -- --release v<that version>`.

## The images serve every installation

Nothing installation-specific is compiled in:

- **Public origin.** Next.js compiles `NEXT_PUBLIC_BASE_URL` into the build.
  Release builds use the placeholder `https://spaceworks-workspace-origin.invalid`.
  When the container starts, `scripts/docker-entrypoint.sh` replaces it with
  the container's `NEXT_PUBLIC_BASE_URL`, after checking that the value is a
  bare origin such as `https://workspace.example.com`. The frontend image does the
  same for `NEXT_PUBLIC_BACKEND_ORIGIN` (placeholder
  `https://spaceworks-workspace-backend.invalid`), the API origin browsers use for
  workspace realtime. A web server without a valid origin refuses to start; the
  `migrate`, worker, beat and operator-tool roles do not apply web placeholders.
- **Server Actions key.** The build uses a random key generated in the
  workflow. It stays in the build output, so it is public, and it is never used:
  Next.js prefers `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` from the runtime
  environment, and the entrypoint refuses to start a release image without it.
  Every installation encrypts with its own key. Keep it stable for an
  installation; rotating it invalidates outstanding Server Action forms.
- **Server Action origins.** `ALLOWED_ACTION_ORIGINS` is compiled into the build
  (empty in release images: same-origin only). The entrypoint refuses to start a
  release image when it is set; build your own image if a CDN on another host
  must invoke Server Actions.

Images built with a real origin (Render, or your own `docker build`) contain no
placeholder, and the entrypoint leaves them alone.

## One-time setup

1. The workflow authenticates with the built-in `GITHUB_TOKEN`
   (`packages: write`, and `contents: write` for releases). No registry token
   or repository secret is needed.
2. After the first run, open each package under the organisation's
   **Packages** tab: **Package settings → Change visibility → Public**.
   GitHub creates new organisation packages as private, and servers pull
   without credentials. The images contain no secrets.
3. Changing anything under `.github/workflows/` needs a GitHub credential with
   the `workflow` scope (for the GitHub CLI: `gh auth refresh -s workflow`).

A fork publishes to its own owner's packages (`ghcr.io/<owner>/…`) when its
`Release` workflow runs. Install from it with `--repo <owner>/<name>`.

## Retrying

Use **Re-run failed jobs**. The images are tagged only after both platforms
have built, and the release is published only after the images are tagged.

## Build secret handling

The Dockerfile reads the build's Server Actions key from a BuildKit secret
mount, so it is not stored in build-argument metadata. As a fallback for
builders that only pass build arguments (Render), it also accepts a
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` build argument, which then exists only in
the builder stage, never in the runner image. The builder stage is rebuilt
every time (`no-cache-filters`). See
[Docker's secret-mount documentation](https://docs.docker.com/build/ci/github-actions/secrets/).

## Retention

Keep immutable release tags and their platform digests. The registry cleanup
job keeps the newest 30 untagged versions per package; tagged releases, rolling
tags and their multi-platform children are retained. The VPS keeps three source
releases locally for rollback. Registry cleanup never deletes tagged releases.

Private package pulls use `SWW_GITHUB_TOKEN`; see the VPS guide. Public packages
need no authentication.
