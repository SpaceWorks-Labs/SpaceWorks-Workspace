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

```bash
npm install
docker compose up -d          # PostgreSQL, Redis, Silo and Mailpit
cp .env.example .env          # fill in AUTH_SECRET and the encryption keys
npm run storage:init          # create the private bucket
npm run db:migrate
npm run dev                   # then open /setup
```

Never commit `.env` or real secrets.

## Before opening a pull request

- Branch from `dev` as `feat/<short-name>` (or `fix/<short-name>`).
- Follow the conventions in [AGENTS.md](AGENTS.md) and the design system in
  [docs/DESIGN.md](docs/DESIGN.md).
- Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, and
  `npm run test:integration` for data or permission changes.
- Every schema change ships a Prisma migration.
- Write "Space Works" in copy; keep UI text short, warm and specific.

By contributing you agree that your contributions are licensed under the
AGPL-3.0-or-later.
