# Client observability and connected analytics

Everything is off by default. Configure instance providers under the admin
observability console (instance settings `obs.*`, or the matching env vars).

## Providers

| Provider | Gated by consent, DNT/GPC and route | Where it runs |
| --- | --- | --- |
| Sentry | No (errors only, no personal data) | Server (`instrumentation.ts`, worker, beat) and browser through `/api/obs/sentry` |
| PostHog | Yes | Browser through `/api/obs/ph/*` |
| Clarity | Yes, plus a workspace owner opt-in | Browser, nonce'd loader |
| Firebase (Google Analytics) | Yes | Browser, nonce'd gtag loader, no SDK |

- A DSN change needs a restart (server Sentry initialises at boot).
- Ids are pseudonymous HMACs (`lib/observability/identity.ts`, HKDF key derived
  from `MFA_ENCRYPTION_KEY`). Never email, name, slug or raw ids. A workspace's
  own PostHog project gets a per-workspace distinct id.
- Consent (`obs.consentMode`): `opt-in` (default, banner sets `sww_consent=analytics:1|0`),
  `opt-out`, `none`. Do Not Track and Global Privacy Control always win.
- Routes: allow-list in `lib/observability/routes.ts`. Vault, secrets, finance,
  chat, DMs, money controls, safeguarding, hiring, funding, payroll, settings and
  `/admin/**` never run PostHog, Clarity or Firebase. Paths are sent as templates
  (`/w/:workspace/projects/:id`).
- Clarity: owners must opt in per workspace; set masking to Strict in the Clarity dashboard.

## Workspace overrides

Precedence (`resolveWorkspaceConnection`): overrides disallowed or provider not
listed -> instance default; `off` -> nothing sent; `own` (complete, valid host)
replaces the instance config and is never sent alongside it; an invalid `own`
sends nothing; `inherit` -> instance; `linkout` -> link only. Hosts must be https,
match `obs.workspaceOverrides.hostAllowlist` and pass the SSRF guard (DNS checked
on save and by the tunnel). Secrets (Metabase embedding secret) are encrypted with
purpose `workspace-analytics`, write-only, and never returned. Saving requires the
acknowledgement checkbox; Clarity needs an OWNER.

## CSP

`OBS_CSP_PROVIDERS`, `OBS_CSP_CONNECT_ORIGINS`, `OBS_CSP_FRAME_ORIGINS` (edge-safe
`lib/observability/csp.ts`, merged by `lib/pageSecurity/extra.ts`). `script-src`
keeps the nonce and `strict-dynamic`. Clarity and Firebase need their providers in
`OBS_CSP_PROVIDERS`; PostHog and Sentry use same-origin tunnels.

## Known limits

- The PostHog tunnel token lives 12 hours (posthog-js fixes request headers at init).
- DNS is resolved and checked, but the forwarding `fetch` does not pin the address.
- Real provider ingestion is untested offline; tests mock `fetch`.
