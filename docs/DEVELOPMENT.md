# Local development

[Documentation index](README.md) · [Contributing](../CONTRIBUTING.md)

Use Node.js 22.18 or newer, npm and PostgreSQL 16. The development Compose file
also offers Redis, private Silo and Mailpit; production uses the separate root
`compose.production.yml` through the VPS wrapper.

```bash
npm ci
cp .env.example .env
docker compose up -d --wait
npm run db:deploy
npm run storage:init
DEMO_PASSWORD='choose-12-or-more-characters' npm run db:seed:demo
PORT=3290 npm run dev:stack
```

Generate independent local keys with `openssl rand -base64 32`. Set both local
canonical URLs to `http://localhost:3290`, and keep `.env` out of Git. The seed
owner is `owner@tinkerspace.test`; each module under `scripts/seed/` adds its area.
Without a seed, open `/setup` to create the first user and workspace. Never run
demo seeding against production.

`local.sh start` offers the same services and generates local keys when no
configuration exists. It uses committed migrations and supervises the web app,
BullMQ worker and beat; email and notifications run in the worker. Local startup
checks loopback-only service targets before touching the database. Redis uses
durable AOF storage and `noeviction`. Mailpit captures messages at
`http://localhost:8025`; worker/beat health binds to loopback on separate ports
3460/3461 (`SWW_DEV_WORKER_PORT`, `SWW_DEV_BEAT_PORT`). On PowerShell set
`$env:PORT='3290'` before `npm run dev:stack`. Add new migrations with
`npm run db:migrate -- --name <area>`; never use schema push.

Run lint, typecheck, unit tests, integration tests against a disposable
`TEST_DATABASE_URL`, and a build. Use `NODE_OPTIONS=--max-old-space-size=4096`
for typecheck/build on constrained hosts. Do not run Docker image builds or
browsers there; CI owns the image/installer and browser smoke jobs.

For split rendering, regenerate reviewed contracts with
`npm run frontend:catalog`. Then run `npm run frontend:prepare` and
`npm run typecheck:frontend`. Generated source trees under `frontend/` are
ignored; edit shared root source and checked-in frontend templates instead.
See [Split hosting](DEPLOYMENT_SPLIT.md) for origins and gateway-only settings.
