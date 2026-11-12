# Email campaigns

Native bulk email for a workspace (module key `campaigns`, nav "Email campaigns").
Audience, consent, public pages, tracking and bounce handling are described
here, followed by sending, the editor and templates.

## Audience model

- `Subscriber` is separate from `Contact`; `contactId` links them when a
  subscriber was imported from contacts (`source = "contact"`). Emails are
  stored lowercase, unique per workspace.
- `MailingList` is PUBLIC (own sign-up page, shown on preference pages) or
  PRIVATE, and SINGLE or DOUBLE opt-in. SINGLE applies only to subscribers an
  admin adds or imports; the public form and the preferences page always use
  double opt-in, whatever the list says. A list a campaign used cannot be
  deleted (archive instead). The `CampaignList` foreign key cascades, so
  deleting a whole workspace is never blocked by campaigns.
- `ListSubscription` states: UNCONFIRMED, CONFIRMED, UNSUBSCRIBED. A
  `Subscriber` is ACTIVE or BLOCKLISTED (reasons `UNSUBSCRIBE_ALL`,
  `BOUNCE_HARD`, `BOUNCE_SOFT_LIMIT`, `COMPLAINT`, `CONTACT_DNC`, `ADMIN`).
- Consent is recorded per subscription (source FORM, IMPORT, ADMIN, CONTACT,
  PREFERENCES plus text). IP and user agent are stored only when
  `CampaignSettings.recordConsentIp` is on.
- Contacts back-sync: a contact set to do-not-contact, or deleted, blocklists
  its subscribers (`lib/contacts/contacts.ts` calls `blocklistSubscribersForContacts`).
  An unsubscribe writes `Contact.consentStatus = DENIED` only for subscribers
  imported from that contact, and only once nothing active remains.

## Admin pages (`/w/[slug]/campaigns/...`)

| Route | Role | Notes |
| --- | --- | --- |
| `lists`, `lists/[listId]` | view MEMBER, manage ADMIN | counts, hosted form URL |
| `subscribers`, `subscribers/import` | ADMIN | search, blocklist, GDPR erase, export, CSV (10,000 rows / 2 MB) and from-contacts import, both need the permission attestation |
| `settings` | ADMIN | tracking, limits, footer address, domain blocklist, bounce secret (shown once), DNS guidance |

Roles live in `lib/campaigns/roles.ts`. Actions: `app/actions/campaign{Lists,Subscribers,Settings}.ts`.

## Public routes

All check the workspace is ACTIVE and the module is on (404 otherwise) and send
`Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`.

- `POST /api/public/campaigns/subscribe`: honeypot `hp`, encrypted timestamp `ts`
  (rejected under 3 s or over 1 h), rate limits `campaignPublic` + `subscribe`
  per IP and per email, workspace domain blocklist. Always the same neutral reply.
  Confirmation mail is bounded further (`subscribeToList`): one per subscriber
  and list per 24 h, `campaignConfirmEmail` (3 per address per day across all
  workspaces) and `campaignConfirmWorkspace` (500 per workspace per day). A
  subscriber who unsubscribed earlier stays UNSUBSCRIBED until the confirmation
  link is used; the form never resubscribes anyone by itself.
- `GET/POST .../confirm/[token]`: GET redirects to the `/m/confirm/[token]` button
  page and never confirms; POST confirms. Single use (hash cleared), 72 h. Accepts UNCONFIRMED and UNSUBSCRIBED rows that hold a pending token.
- `GET/POST .../unsubscribe/[token]`: POST without a `choice` is RFC 8058
  one-click (200, empty body, no CSRF check); `choice=all` blocklists
  (`UNSUBSCRIBE_ALL`); `choice=prefs` goes to preferences. GET redirects to `/m/unsubscribe/[token]`.
- `GET .../o/[token]` (43-byte GIF) and `GET .../c/[token]/[linkId]` (302 to the
  stored URL, http/https only). Counters only unless the campaign snapshotted
  individual tracking; IP and user agent are never read. Image proxies share IPs,
  so over 120 requests per minute per IP the pixel and the redirect are still
  served but nothing is counted.
- Hosted pages: `/m/[workspaceSlug]/subscribe/[listSlug]`, `/m/confirm/[token]`,
  `/m/unsubscribe/[token]`, `/m/preferences/[token]` (own rate limit), `/m/done/[kind]`.
  The split frontend catalog must be regenerated for `/m`.

## Bounces

`POST /api/public/campaigns/webhooks/postmark/[workspaceId]` and `.../ses/[workspaceId]`.
Both require the workspace secret (`CampaignSettings.bounceWebhookSecretEnc`,
purpose `campaign.bounce`) as the `x-webhook-secret` header or the Basic auth password (a `?secret=` query
parameter is not accepted, because URLs end up in logs; configure the provider
with a custom header or `https://user:SECRET@host/...`), an unknown workspace and a wrong secret both answer 401,
compared with `safeEqual`; SES additionally verifies the SNS signature with a
certificate fetched only from `sns.<region>.amazonaws.com`. The SES secret is an
extra guard so another AWS account cannot forge events for a workspace.
`SubscriptionConfirmation` is never auto-confirmed (an admin must do it in AWS).
Events dedupe on `providerEventId`. Policy (`lib/campaigns/bounce/record.ts`,
also used for SMTP rejects): HARD and COMPLAINT blocklist at once and set
`Contact.doNotContact`; SOFT blocklists at `softBounceLimit` within 30 days.

## Known limits

- The double opt-in email goes through the outbox as a `campaign.confirm` row
  that holds the confirm URL only until it is sent (a capability kind: deleted
  after delivery or terminal failure, rendered with the workspace SMTP). The
  token is single use and expires after 72 h.
- A SNS subscription confirmation URL is not stored, so the admin cannot copy it
  from Space Works; use the AWS console or CLI.

## Sending, editor and templates

### Sending worker

`lib/scheduled/campaigns.ts` runs `runCampaignSending` (`lib/campaigns/send/worker.ts`)
every 10 seconds on the scheduled queue; there is no dedicated queue. Each tick
has a 45 s budget and skips workspaces whose `campaigns` module is off.

1. **Promote.** Due `SCHEDULED` campaigns become `RUNNING` atomically
   (`promoteDue`). Tracking flags are snapshotted here: a flag is on only when
   the campaign **and** the workspace setting are on, and later setting changes
   do not affect the running campaign. The monthly cap is checked at promotion.
2. **Lock.** A worker locks one campaign at a time (`lockedAt`/`lockedBy`,
   stale after 5 min) so two ticks or two instances never work the same one.
3. **Materialise.** Recipients are inserted into `CampaignMessage` in keyset
   chunks of 500 by subscriber id (ACTIVE subscribers with a CONFIRMED
   subscription on any campaign list). `(campaignId, subscriberId)` is unique,
   so a rerun is idempotent and a subscriber on several lists gets one message.
4. **Claim.** Due `PENDING` rows are claimed with `FOR UPDATE SKIP LOCKED`.
5. **Rate.** A per-workspace token bucket (`CampaignSettings.sendPerMinute`)
   limits throughput; Redis-backed when available, in memory otherwise.
6. **Send.** `processMessage` re-checks the subscriber (still ACTIVE and
   confirmed on a campaign list, same workspace) and otherwise marks the
   message `SKIPPED`. A message that was unsubscribed mid-run is never sent.

Failures: a 5xx reply or a rejected recipient is permanent. The message becomes
`FAILED` and the address goes through `recordBounce` (HARD, source
`SMTP_REJECT`), so the bounce policy applies: the subscriber is blocklisted and
a linked contact is set to do-not-contact. Other errors (auth, network, 4xx)
retry after 1 min then 5 min; the third attempt fails the message. An
in-memory consecutive-failure streak above `maxErrors` pauses the campaign
(`PAUSED`, reason `max_errors`). When the monthly email cap is reached it
pauses with `monthly_cap`; resuming continues once there is headroom. Missing
footer address or SMTP pause with `footer_missing` / `no_smtp`. A workspace
that is not ACTIVE, or has the module off, stops sending without changing the
campaign.

The worker is at-least-once: a crash after the SMTP server accepted a message
and before the row is marked `SENT` can deliver that message twice (the
deterministic `Message-ID` lets a receiving server dedupe, but it is not
guaranteed to).

Without workspace SMTP the shared relay is used and a campaign is capped at
500 recipients (`SHARED_SMTP_RECIPIENT_LIMIT`; the pre-send checklist warns).

Crash safety: the `Message-ID` is deterministic (`<c-{messageId}@{domain}>`), so
a retry after a crash reuses it. Claims older than 10 min are recovered: no
provider id returns the row to `PENDING`, a stored provider id marks it
`SENT`. Campaign counters are recomputed from message rows (`recount`).
Cancelling skips every open message. When nothing is left the campaign is
`FINISHED` and the creator is notified.

From address: the configured workspace sender address is always used, with the
campaign's from-name; the stored `fromEmail` is ignored. Reply-to is the
campaign's, else the workspace's. Every message carries `List-Unsubscribe`
(RFC 8058 one-click) and `Precedence: bulk`.

Tracking: opens add a 1x1 pixel; click tracking rewrites only http(s) `<a>`
links in the HTML part (never the plain text, placeholder or mailto links)
through `/api/public/campaigns/c/...`. Individual engagement rows exist only
when individual tracking is on, and are purged after 13 months (hourly job in
`lib/scheduled/campaigns.ts`).

### Campaign states and audit

`DRAFT` > `SCHEDULED` > `RUNNING` > `FINISHED`, with `PAUSED` and `CANCELLED`
(`lib/campaigns/campaigns/state.ts`). Audit events are all recorded through
`auditCampaignEvent` as `campaigns.<name>`: `campaign_created`, `campaign_deleted`,
`campaign_scheduled`, `campaign_started`, `campaign_paused`, `campaign_cancelled`,
`campaign_finished`, `campaign_test_sent`, `template_deleted`, plus the audience
events above. Metadata is limited to counts and enums, never an address or body.

### Editor and content

Routes: `campaigns` (list), `campaigns/new`, `campaigns/[campaignId]` (editor,
stats under `stats`), `campaigns/templates`. Content types: RICHTEXT, MARKDOWN,
PLAIN and HTML. Raw HTML can be edited and copied by ADMIN only; scheduling,
sending, pausing and cancelling are ADMIN (`lib/campaigns/roles.ts`).

Every body is built server-side (`lib/campaigns/campaigns/content.ts`) and passed
through the allow-list sanitiser (`lib/campaigns/sanitize.ts`, 500,000 characters):
https images, tables, headings, links, lists and a short list of inline styles
are kept; scripts, iframes, forms, style tags, event handlers and `data:` URLs
are removed. The plain-text alternative is generated from the HTML (PLAIN uses
the source). The postal-address footer with unsubscribe and preferences links is
always appended.

Placeholders are a fixed lookup, not a template engine: `{{name}}`,
`{{first_name}}`, `{{email}}`, `{{unsubscribe_url}}`, `{{preferences_url}}`,
`{{workspace_name}}` and `{{attr.key}}` from subscriber attributes. Values are
HTML-escaped, newlines are stripped in subjects, unknown names render empty and
substituted text is never expanded again.

### Templates and test send

`EmailTemplate` rows hold sanitised HTML with a `{{content}}` slot; one can be
the workspace default, and a built-in default is used otherwise. Saving and
deleting templates is audited (`template_deleted`).

Test send goes through the transactional outbox to the caller plus up to 5
extra addresses, subject prefixed `[Test]`, links inert, no tracking. A MEMBER
may only add addresses of active members of the workspace; an ADMIN may add any
address. Each user has 20 recipients per day (`campaignTestSend`). Test sends
are not counted in the monthly email cap (no per-message row exists for them).

### Pre-send checklist

Shown in the send dialog (`presendChecklist`). Blocking: a list is selected, the
footer address is set, sending is configured, at least one confirmed recipient,
within the monthly cap. Advisory: a test email was sent, DNS (SPF, DKIM, DMARC)
reminder, and a warning when the cap leaves fewer emails than recipients.
