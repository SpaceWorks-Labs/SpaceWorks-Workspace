# Contributing to Space Works Workspace

Space Works Workspace is the private operating tool of the Space Works maker
community. It is built in the open at
[github.com/SpaceWorks-Labs/SpaceWorks-Workspace](https://github.com/SpaceWorks-Labs/SpaceWorks-Workspace)
under the AGPL-3.0-or-later licence.

## Ways to help

- **Report a bug.** Open an issue with what you expected, what happened and the
  steps to repeat it.
- **Suggest an idea.** Describe the problem your community has before the
  solution you have in mind.
- **Send a pull request.** For anything larger than a small fix, open an issue
  first so we can agree on the approach.

## Security issues

Please don't report vulnerabilities in a public issue. Use GitHub's private
vulnerability reporting (Security → Report a vulnerability) and allow time for
a fix before disclosing.

## Local setup

Use Node.js 22.18 or newer (`.nvmrc` pins major 22), npm and Docker.

```bash
git clone --recurse-submodules https://github.com/SpaceWorks-Labs/SpaceWorks-Workspace.git
cd SpaceWorks-Workspace
npm ci
cp .env.example .env                  # fill in AUTH_SECRET and the encryption keys
docker compose up -d --wait           # PostgreSQL, Redis, Silo and Mailpit
npm run db:deploy
npm run storage:init                  # create the private bucket
DEMO_PASSWORD='choose-12-or-more-characters' npm run db:seed:demo
PORT=3290 npm run dev:stack           # web, worker and beat; open http://localhost:3290
```

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) is the full guide. Without a seed, open `/setup`
to create the first workspace. Add a migration with `npm run db:migrate -- --name <area>`.
Never commit `.env` or real secrets.

The Design-Kit submodule in `design-kit/` is optional: builds use the generated
files that are already committed. Only when you change design tokens, run
`git submodule update --init --depth 1` and then `npm run tokens:sync` to
regenerate `app/styles/palette.css`, `app/styles/motion.css` and the token fixture.

## Before opening a pull request

- Branch from `dev` as `feat/<short-name>` (or `fix/<short-name>`) and open the
  pull request against `dev`. Only maintainers merge `dev` into `main`.
- Follow the conventions in [AGENTS.md](AGENTS.md) and the design system in
  [docs/DESIGN.md](docs/DESIGN.md).
- Keep every hand-written file (source, tests, scripts, CSS) at 300 lines or
  fewer. Split by responsibility. Generated files, the Prisma schema,
  migrations and lockfiles are exempt.
- Run `npm run lint`, `npm run typecheck` and `npm run test:unit`. Run
  `npm run test:integration` against a disposable `TEST_DATABASE_URL` for data or
  permission changes (`npm run db:test:prepare` applies migrations to it), and `npm run test:e2e`
  for user-facing flows.
- Every schema change ships a Prisma migration.
- Update the relevant docs and [CHANGELOG.md](CHANGELOG.md) with behaviour changes.
- Write "Space Works" in copy; keep UI text short, warm and specific.
- Commit messages are one short line in conventional style, for example
  `fix: stop assignment losing updates`, `docs(cli): document registry install`
  or `chore(deps): bump next`.

By contributing you agree that your contributions are licensed under the
AGPL-3.0-or-later.
