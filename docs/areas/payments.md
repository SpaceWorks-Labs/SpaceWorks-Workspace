# Payments

Online payment for invoices only, through a workspace's own Stripe or Razorpay
account. Space Works creates a provider-hosted payment link (no card data
touches this app, no CSP change). Settings live at
`/w/[slug]/settings/payments` (ADMIN with `canManageFinance`); the invoice page
has an "Online payment" panel.

## Accounts and secrets

- `PaymentProviderAccount` (one per workspace and provider). Keys, the webhook
  signing secret and the Razorpay key id are one AES-256-GCM blob
  (`credentialsEnc`, purpose `payment-credentials`). They are write-only: pages
  receive `AccountView` only (mode, status, verified time, webhook URL).
  Blank secret fields on update keep the saved value.
- Mode (`test`/`live`) comes from the key prefix and is kept in `config`.
  Live keys are refused unless `NEXT_PUBLIC_BASE_URL` is https.
- Verify: Stripe `GET /v1/balance`, Razorpay `GET /v1/payments?count=1`.
- Plain `fetch` through `lib/integrations/http.ts` (timeout, bounded reads, no
  redirects). Stripe's API version is pinned in `lib/payments/stripe.ts`
  (`STRIPE_API_VERSION`); review it when upgrading.

## Payment links

Only SENT invoices. `InvoicePayment` is created first (its id is the provider
reference: Stripe `client_reference_id`, Razorpay `reference_id`), then the
provider is called. A CREATED link for the same invoice, provider and amount
younger than 20 hours is reused. Stripe Checkout sessions expire after 23
hours; Razorpay links after 14 days. Razorpay is INR only. The Stripe return
URL is the app base URL. `renderInvoiceEmail` adds the link to the body of
"Send"/"Email again" when a CREATED link exists.

## Webhook

`POST /api/payments/[provider]/[token]` (`stripe` or `razorpay`; `token` is
`PaymentProviderAccount.webhookToken`). Order: rate limit (`paymentWebhook`) →
token lookup (404) → raw body, at most 512 KB → signature (400) → JSON → one
transaction. Stripe: `Stripe-Signature` `t=`/`v1=` HMAC-SHA256 over
`t.body`, 5 minute tolerance. Razorpay: `X-Razorpay-Signature` hex HMAC of the
body. Both compare in constant time. Nothing from the body, headers or keys is
logged.

In the transaction: insert `PaymentWebhookEvent (provider, eventId)` with
`skipDuplicates` (replay → 200 `duplicate`), find the `InvoicePayment` scoped to
the token's workspace (cross-tenant ids never resolve), lock it, then:

- paid: amount and currency must equal the link and the invoice total, then
  `settleInvoiceFromPayment` (lib/finance/service/invoices.ts) takes the
  finance lock, row-locks the invoice, requires SENT and an open month, flips
  to PAID and posts one idempotent INCOME entry (no actor, audit
  `finance.invoice_paid`). Anything else (mismatch, signed-off month, invoice
  already paid, void or draft) leaves the invoice untouched and marks the
  payment NEEDS_REVIEW plus a `finance.payment.failed` notification.
- failed/expired: CREATED becomes FAILED/EXPIRED.
- refunded: `refundedMinor` is set to the provider's cumulative amount (never
  summed), status becomes PARTIALLY_REFUNDED or REFUNDED.

Notifications use `dispatch` (`finance.invoice.paid`, `finance.payment.failed`,
`finance.payment.refunded`) with owners and admins as recipients.
Unrecognised events and replays return 2xx; an unexpected error returns 500 so
the provider retries (the transaction rolled back, so the event is not marked
seen).

## Refunds

The panel's "Refund…" asks the provider (Stripe `/v1/refunds`, Razorpay
`/payments/:id/refund`) and audits the request. The webhook is the only writer
of refunded amounts. A refund does not change the invoice or ledger: void the
invoice (which voids its income) or record an expense yourself.

## Known limits

- The provider-hosted link is a pay-only bearer URL. The invoice email is a
  pre-rendered outbox "email" payload, which the outbox retains after sending
  (see `lib/outbox.ts` notes); a render-time kind would avoid storing it.
- Editing a SENT invoice after a link exists makes a later payment land in
  NEEDS_REVIEW (amount check); create a new link instead.
- Live provider calls are covered by mocked-fetch unit tests only.
