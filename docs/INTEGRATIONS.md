# Integrations setup

Use a public HTTPS instance URL (`<base>`). Set `INTEGRATION_ENCRYPTION_KEY` to a base64-encoded 32-byte key before connecting providers. Back up this key: credentials cannot be recovered without it. Bot tokens, signing secrets, OAuth tokens and webhook URLs are encrypted and write-only. Saving blank secret fields retains their saved values.

Admins manage workspace integrations. Members link their own external accounts at Notifications → Connected accounts. All tests mock provider HTTP calls.

## Notification destinations and rules

Settings → Notifications offers email lists, workspace channels, in-app role groups, Slack, Discord, Mattermost, Telegram, WhatsApp and signed webhooks. Bot destinations require a verified connection from Settings → Messaging. Incoming webhook destinations use their own encrypted URL. Email uses the instance outbox; notification, invoice and campaign mail uses the workspace's own SMTP when set under Settings → Email sending, otherwise the instance SMTP. Account mail (invites, reset, verification) always uses the instance SMTP.

Add a destination, use **Send test**, then check **Recent deliveries**. Delivery rows show status, attempts and safe errors; terminal failures can be retried. Temporary failures back off through the existing outbox machinery (30 seconds up to six hours, six attempts), respecting provider Retry-After. Permanent failures mark destination health Error and alert admins.

Rules accept exact event names, `area.*`, `*`, or event categories; minimum severity; project, monitor and tag filters; quiet hours; deduplication and reminder intervals. Ratings are not part of the shared event contract and are not available as a filter. Reminders repeat the latest warning/critical event with a thread key, stop when a newer original event uses that key, and expire after seven days. Quiet hours apply; critical bypass is configurable. Use 0 to disable reminders.

## Slack

1. Create an app at [Slack apps](https://api.slack.com/apps). Enable a bot and add `chat:write`, `im:write`, `im:history`, `app_mentions:read`, `channels:history`, `commands`. Add any further history scopes needed for channels you explicitly bridge.
2. Install the app in your Slack workspace. Copy the bot token (`xoxb-…`) and Basic Information → Signing Secret.
3. Settings → Messaging → Slack: enter both secrets, save and **Verify**. Verification calls `auth.test`, records the workspace and bot identity, and enables the connection.
4. Set Event Subscriptions Request URL to `<base>/api/integrations/slack/<id>/events`; subscribe to `message.im`, `app_mention` and channel message events you need for bridges. Space Works answers Slack's signed challenge.
5. Add slash command `/sw`, POST to `<base>/api/integrations/slack/<id>/commands`. Supported text: `ask question`, `link CODE`, `unlink`. Invite the bot to destination/bridged channels.
6. For notification-only incoming webhooks, enable Incoming Webhooks in Slack, generate a URL, and save it in the destination's encrypted Webhook URL field instead of selecting a bot connection.

Slack requests use v0 HMAC-SHA256 over `v0:timestamp:raw-body`, with a five-minute freshness check. Bot messages use Block Kit and a plain-text accessibility fallback. Assistant replies and account-link results are sent privately.

## Discord

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications). Add a bot, copy its token and General Information → Public Key.
2. Settings → Messaging → Discord: enter the token/public key and optionally a guild id, then save and verify. Verification checks the key against the application and registers `/ask`, `/link`, `/unlink` and `/post`.
3. Set Interactions Endpoint URL to `<base>/api/integrations/discord/<id>/interactions`. Space Works verifies Ed25519 signatures over timestamp + raw body and answers signed PING requests.
4. Install the application with `bot` and `applications.commands` scopes. Grant View Channels, Send Messages and Embed Links in intended channels.
5. Notifications support bot channels or Discord webhook URLs. Messages disable all allowed mentions. Slash responses are deferred and completed ephemerally.

Ordinary Discord messages arrive through the optional Gateway, which this app does not run. Incoming `/post` messages on a bridged channel and outbound text bridges work without privileged message intents. An external Gateway service can be added separately; it must authenticate its own transport and preserve bot/echo detection. Do not send unsigned Gateway payloads to the interactions endpoint.

## Mattermost

1. Enable bot accounts in your Mattermost system console; create a bot and access token.
2. Settings → Messaging → Mattermost: save the server URL and bot token, then verify. The URL is checked for SSRF on every request.
3. Add a `/sw` slash command (POST) targeting `<base>/api/integrations/mattermost/<id>/commands`. Save its token in the encrypted Slash command token field.
4. For public-channel bridging, add an outgoing webhook for the channel, with no trigger words, targeting `<base>/api/integrations/mattermost/<id>/events`. Save its token in Outgoing webhook token. Mattermost outgoing hooks cover public channel posts, not all direct messages; use `/sw ask` for assistant access.
5. Add the bot to destination channels. Notification-only incoming webhooks can instead be entered directly on destinations.

Inbound requests compare the command/outgoing token in constant time. Private-network servers require the explicit instance opt-in described under Security.

## Telegram

1. Use [BotFather](https://t.me/BotFather) to create a bot and obtain its token.
2. Settings → Messaging → Telegram: save the token, then verify. Space Works checks `getMe` and registers `<base>/api/integrations/telegram/<id>/events` using a generated encrypted secret token. Incoming requests must carry `X-Telegram-Bot-Api-Secret-Token`.
3. For public-group bridging, add the bot to the group and disable privacy mode in BotFather if you need ordinary group messages. Destinations use a numeric chat id or public `@channelname`.
4. Members start a private chat with the bot and send `/link CODE`; then DM questions, `/ask question`, or mention the bot in a group. Assistant responses go privately.

One Telegram connection is allowed per workspace. Message bodies use escaped HTML parse mode and respect the 4096-character limit. Verification preserves pending Telegram updates.

## WhatsApp Cloud API

1. Create a Meta business app with WhatsApp enabled. Obtain the Phone Number ID, App Secret and a system-user access token with WhatsApp messaging permissions.
2. Settings → Messaging → WhatsApp: enter these values. Choose a random webhook verification token and enter it in the password field. Save and verify the phone number.
3. Configure `<base>/api/integrations/whatsapp/<id>/events` as the callback URL in Meta, using the same verification token. Subscribe to messages. GET verification requires the chosen token; POST delivery requires `X-Hub-Signature-256` using the app secret.
4. Create an approved utility template, for example `spaceworks_notification`, with one body parameter containing the notification summary. Save its name and language on the connection or destination.
5. Members opt in by sending `link CODE` privately to the business number. Unlinking withdraws that opt-in for personal notifications. Admins must also have consent for numbers entered as shared notification destinations.

Free text is sent inside the 24-hour window following an authenticated inbound message from that number. Outside the window an approved template is required. A provider window-closed error also falls back to the configured template. WhatsApp does not support workspace channel bridges.

## Generic signed webhooks

Configure a URL and a random signing secret of at least 16 characters. Every POST has these headers:

| Header | Meaning |
| --- | --- |
| X-SpaceWorks-Event | Event type |
| X-SpaceWorks-Delivery | Delivery id; deduplicate retries with this value |
| X-SpaceWorks-Timestamp | Unix seconds |
| X-SpaceWorks-Signature | `v1=` followed by hex HMAC-SHA256 of `timestamp.rawBody` |

Verify the raw bytes, require a timestamp within five minutes, and compare signatures with constant-time comparison. Acknowledge quickly. Redirects are refused. 429, timeout and server failures retry; other client errors are terminal.

## Member linking and assistant runtime

Create a code in Notifications → Connected accounts. Codes are random, single-use and expire after ten minutes; only SHA-256 hashes are stored. Send `/link CODE` on Telegram, `/link code:CODE` on Discord, `link CODE` by WhatsApp/Slack DM, or `/sw link CODE` on Slack/Mattermost. Use the Unlink button or send `unlink` to remove an identity.

The bot rechecks active workspace membership before each assistant request and runs as the linked member. The assistant area must register its existing runtime with `registerMessagingAssistantRunner` from `lib/integrations/assistant.ts`. That runtime is absent in this checkout; until registered, users receive an explicit unavailable message. No assistant tools are reimplemented by the transport. See [area contract](areas/integrations-messaging.md).

## Channel bridges

Settings → Messaging maps a public, non-team workspace channel to an external channel in either direction. Private/team channels cannot be bridged. Only text is mirrored. Bot echoes are ignored, origin-tagged workspace messages are excluded from outbound reads, and message-id pairs prevent repeated inbound inserts and outbound sends. Mirroring runs in the outbox scheduler about once a minute. Deliveries are at least once; a crash after a remote send but before recording its id can repeat a post.

## Google

1. Create a Google Cloud project and enable Calendar API, Gmail API, Drive API and Search Console API.
2. Configure the consent screen, test users and required Google verification for restricted Gmail scopes. Create a Web application OAuth client with redirect URI `<base>/api/integrations/google/callback`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (the sign-in client is the fallback) and restart.
4. Settings → Integrations → Connect Google. Consent requests offline access with PKCE S256 and hashed, expiring CSRF state. Tokens are encrypted and refreshed server-side. Disconnect revokes access at Google before deleting the connection.
5. The connecting admin can list calendars/events, create a Calendar meeting, browse recent mail, create a Gmail draft and browse Drive metadata. Drafts must be reviewed and sent in Gmail. Other admins cannot access this account's personal services.
6. SEO → Connect Search Console sites imports verified properties. Sync now or wait for daily sync. Charts include daily values, top queries/pages, CTR and impression-weighted position. URL inspection, sitemap list/submit and on-page audits are scoped to the property.

Requested scopes: `openid`, `email`, `calendar.events`, `calendar.calendarlist.readonly`, `gmail.readonly`, `gmail.compose`, `drive.metadata.readonly`, `webmasters` (full Google scope URLs in the implementation). Search Console publication lag and anonymised query data can make detailed rows differ from site totals.

## GitHub App

1. Register a GitHub App with callback URL `<base>/api/integrations/github/callback` and **Request user authorization (OAuth) during installation** enabled. Use the same URL for setup if configured. Set webhook URL `<base>/api/integrations/github/webhook` and choose a random webhook secret.
2. Grant read access to Metadata, Pull requests, Issues, Actions and Contents. Subscribe to Pull request, Issues, Workflow run, Check run, Release and Installation events.
3. Set `GITHUB_APP_ID`, `GITHUB_APP_NAME`, `GITHUB_APP_PRIVATE_KEY` (PEM; escaped newlines supported) or `GITHUB_APP_PRIVATE_KEY_FILE`, `GITHUB_WEBHOOK_SECRET`, and the App's `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. Restart. The last two settings verify that the installing GitHub user can access the selected installation; an installation id alone is never accepted as proof. Repository sync is restricted to repositories visible to that GitHub user at connection time; reconnect to authorise newly available repositories.
4. Settings → Integrations → Install GitHub App. Choose repositories, authorise the App, then return to Space Works and Sync repositories. Link repositories to projects with the project selector.
5. Signed webhooks populate the activity feed and emit `github.*` events through notification routing. Installation suspension/deletion disables local access. Disconnect removes the local connection; uninstall in GitHub to remove the remote installation.

The exported `GithubPullRequests` Server Component lists open PRs and issues for a visible linked project. The tasks area can import it without changing its permissions contract. See the area doc for props.

## Security and operation

- Keep the outbox scheduler enabled (in process or the existing internal outbox endpoint). It drains notifications and inbound events, bridges text, emits GitHub events, sends reminders and synchronises SEO. Inbound event processing uses five-minute leases and six attempts; inbound rows expire after 14 days.
- User URLs allow HTTP(S), reject URL credentials and unexpected ports, reject private/reserved addresses, and check all DNS answers. A per-request Undici agent validates DNS again at socket connection time to prevent rebinding. Redirects are never followed. `ALLOW_PRIVATE_WEBHOOK_TARGETS=true` explicitly permits private services for trusted self-hosted deployments.
- Keep webhook secrets and encryption keys out of logs. Request bodies containing link codes are reduced to hashes before persistence. Discord interaction tokens are encrypted in the transient inbound payload.
- All automated provider tests mock `fetch`; no real third-party API is called in tests.

Official references: [Slack signatures](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding), [Telegram Bot API](https://core.telegram.org/bots/api), [Mattermost outgoing webhooks](https://docs.mattermost.com/developers/integrate/webhooks/outgoing), [WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/), [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [GitHub signatures](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [Undici Agent](https://github.com/nodejs/undici/blob/main/docs/docs/api/Agent.md).
