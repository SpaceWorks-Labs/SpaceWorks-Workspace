# Netlify frontend with a Docker VPS backend

[Documentation index](README.md) · [VPS installation](DEPLOYMENT_VPS.md)

The `frontend/` workspace renders the shared Next.js UI. Authentication,
permissions, tenant queries, private files, actions and background jobs run on
the VPS. The same frontend container runs in the default two-hostname VPS layout.

| Host | Runs |
| --- | --- |
| `workspace.example.com`, Netlify or frontend container | Shared pages, thin Server Actions, same-origin API proxy |
| `api.workspace.example.com`, backend container | Guarded view/action gateway, Auth.js, APIs, files, realtime, integrations and jobs |
| Private Docker network | TLS PostgreSQL, authenticated TLS Redis, private Silo storage, worker and beat |

Choose **3** in the curl installer. Point the API A/AAAA records at the VPS;
point the website records at Netlify. Keep both hosts on the same reviewed
revision. `AUTH_URL` and `NEXT_PUBLIC_BASE_URL` on the backend name the website.
First-run setup is `/setup`; all later membership is invite-only.

## Netlify settings

Set **Package directory = frontend**, leave **Base directory = repository root**,
and select `frontend/netlify.toml`. It uses Node 22, runs `npm run build:frontend`
and publishes `frontend/.next`. Use Netlify's Next.js adapter; no static export.
Copy these values from the generated owner-only `frontend.env` into Netlify's
build and functions/runtime environment, without Compose's surrounding quotes:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_BASE_URL` | Exact website HTTPS origin |
| `BACKEND_ORIGIN` | Exact backend HTTPS origin |
| `NEXT_PUBLIC_BACKEND_ORIGIN` | Same backend origin, for direct realtime streams |
| `FRONTEND_GATEWAY_SECRET` | Independent random 32-byte hex peer key, same on backend |
| `FRONTEND_TRUSTED_IP_HEADER` | `x-nf-client-connection-ip` on Netlify; `x-real-ip` behind Caddy |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Independent stable frontend key, at build and runtime |
| `OBS_CSP_PROVIDERS`, `OBS_CSP_CONNECT_ORIGINS`, `OBS_CSP_FRAME_ORIGINS` | Optional; the same values as the backend when client analytics or Metabase frames are on, because the website builds its pages' CSP |

The frontend has no database, Redis, Auth.js signing, mail, storage, MFA, vault
or integration encryption credentials. Restrict production credentials to the
canonical production deploy; previews use their own backend and secrets.

## Gateway and authentication

`frontend/catalog.json` is the fixed allowlist. Generated readers execute the
original page's authentication and workspace/MFA checks on the backend. The
peer credential identifies a server; it grants no user or tenant role. The
backend forwards no permission claims from a browser. Views accept only bounded
route/query values. DTOs omit persistence secrets; the handler rejects secret
fields again. Actions retain their validation, audit, rate limits and transactions.
Invalidations and local redirects return to the frontend. Response cookies stay
host-only on the website. Keep OAuth callbacks on the website origin.

`npm run frontend:catalog` regenerates reviewed contracts when pages or actions
change. `npm run frontend:prepare` makes the ignored rendering tree. Builds
reject database, Redis, mail and object-storage clients in deployment traces.
Edit root sources and frontend templates, never generated frontend files.

Browser `/api/*` requests use the website origin. Internal jobs, readiness and
private gateway routes return 404 there. Non-API resources (private exports,
assistant streaming, document presence, calendar feeds, blog feeds/covers and
public status summaries/badges) use an exact generated resource allowlist.
MCP, heartbeats and signed integration webhooks can target the backend hostname directly. The frontend also forwards their bounded bodies and signature/protocol headers; the backend retains native signature/capability validation. The same applies to payment webhooks (`/api/payments/...`), campaign bounce webhooks, one-click unsubscribe and the public subscribe endpoint, which are published on the website origin, and to Sign in with Apple's cross-site `form_post` callback, which keeps its cookies so Auth.js can check state and nonce.
Keep webhook signatures and machine bearer checks intact; gateway trust never
replaces those checks.

## Realtime

The browser asks its own origin for a one-use, 60-second stream ticket after
session and workspace checks. Redis stores only its SHA-256 digest and the
user/workspace/session-version binding. The browser then opens an EventSource
directly to the backend. Each connection consumes its ticket, rechecks active
membership and session version, and sends only the existing audience-filtered
ids/kinds. Only the canonical website origin gets CORS. No cross-host session
cookie is needed. Reconnect obtains a fresh ticket; suspension/revocation is
rechecked at most every ten minutes. Never log ticket URLs. Caddy suppresses
request URI/header logging and flushes streaming responses.

## Verify and update

Exercise setup, login/logout, invitation, password reset, MFA, task mutation,
chat streaming/reconnect, private document/file export, finance restrictions,
public blog/status, assistant streaming and cross-tenant denial through the
website. Verify internal endpoints stay unavailable there. Check both HTTPS
names and backend operator checks. Test OAuth/SMTP and a restore in the real
hosting environment. Netlify plan duration and upload limits still apply.

Update the backend through the installer, then deploy the identical revision
on Netlify. Preserve the gateway key and each host's own action key. Hostname
changes require DNS, canonical URLs, OAuth callbacks and frontend redeployment;
release containers apply their public origins at start. Keep redirects for old
invitation and published blog links.

For isolated CI verification, `npm run test:e2e:split` builds both production
servers with separate action keys and disposable dependencies. Do not run the
Docker/browser suite on a memory-constrained development machine.

Worker and beat run from the backend image on the VPS with backend runtime settings. They expose no public routes; Netlify receives no Redis or job-processing credentials. See [jobs operations](areas/jobs-queue.md).
