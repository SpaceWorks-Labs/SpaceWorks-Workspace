# Space Works Workspace CLI

Install Node 20 or newer, then install the package:

```sh
npm install --global @spaceworks-labs/workspace-cli
sww login --host https://workspace.example.org
sww init --host https://workspace.example.org --project PROJECT_ID --env dev
sww secrets list
sww secrets get API_URL
sww secrets set 'API_KEY=replace-me'
sww run --env dev -- npm run dev
```

Login prints a device code and opens a verification page. Check the code and device name before approving. You must sign in to the workspace; members with two-step verification must enter a fresh code. `--no-open` prints the URL without launching a browser. The project ID is shown in the Secrets screen.

`.sww.json` contains only host, project, environment and path. Commit it if useful. Keep `.env` and generated secret exports out of Git. The CLI uses the macOS keychain or Linux Secret Service when available, falling back to `~/.config/sww/credentials.json` with mode 0600. `SWW_CONFIG_DIR` changes the credential directory; `SWW_DISABLE_KEYCHAIN=1` forces the protected file fallback.

```sh
sww secrets pull --env production --format env --mfa 123456 > .env
sww export --env dev --format json --mfa 123456
sww secrets delete OLD_KEY --env dev --path /api
sww whoami
sww tokens
sww tokens revoke SESSION_ID
sww logout
```

Every member export and production reveal requires a fresh authenticator code; verification lasts five minutes. Prefer the browser device approval for the first export. A user without two-step verification can list, write and reveal non-production keys, but must enrol before exporting. Set and delete operations against protected environments submit an independent change request. An admin approves it in the existing approvals inbox; the CLI never bypasses approval. Session revocation also lives under Account → CLI devices. Access tokens last 15 minutes, refresh rotates credentials, and the refresh session expires after 30 days. Disabled accounts, session-version changes and revoked sessions invalidate access immediately.

Avoid placing real secret values or one-time codes in saved shell history. `set` accepts one `KEY=value` argument; the part after the first equals sign is the value. Redirecting `pull` intentionally creates a plaintext file; `run` injects resolved values into a child process without writing them to disk. Child output is inherited, signals are forwarded, and the child's exit code is preserved. The `SWW_TOKEN` variable is removed from the child's environment.

For CI, create an expiring service token scoped to the exact environment and folder, optionally with an IP/CIDR allowlist:

```sh
SWW_TOKEN="$SWW_SECRETS_TOKEN" npx @spaceworks-labs/workspace-cli run \
  --host https://workspace.example.org --project PROJECT_ID \
  --env production --path / -- node server.js
```

Machine tokens do not use interactive MFA. Their holder can read the scope until expiry or revocation; store the token in your CI secret store. Tokens are read-only unless an admin explicitly allows writes. Writes still require protected-environment approval. References cannot escape the token's exact environment and path. No third-party sync connectors are included.

The direct read endpoint is also available:

```sh
curl -fsSL -H "Authorization: Bearer $SWW_SECRETS_TOKEN" \
  'https://workspace.example.org/api/v1/secrets?project=PROJECT_ID&environment=production&path=/&format=env' > .env
```

Use HTTPS; HTTP is supported only on localhost. Do not source exported `.env` files as shell scripts. The env format is quoted data for environment-file loaders; JSON and YAML formats use quoted string values.

## Node SDK

```js
import { getSecrets, clearSecretsCache } from '@spaceworks-labs/workspace-cli';

const values = await getSecrets({
  host: 'https://workspace.example.org',
  token: process.env.SWW_TOKEN,
  project: 'PROJECT_ID',
  environment: 'production',
  path: '/',
  cacheTtlMs: 0,
});
```

`getSecrets` returns a resolved string dictionary. Caching is disabled by default, optional up to five minutes (at most 100 entries, up to 1 MB per entry), held only in process memory, and keyed by host/scope/token digest. Revocation takes effect on the next uncached request; use zero TTL when immediate revocation is required. `clearSecretsCache()` removes all cached values. Do not send values to logs, analytics or error reports.

## Build and package

From the repository root:

```sh
npm run build --workspace packages/cli
npm pack --workspace packages/cli
npm publish --workspace packages/cli
```

The package has no runtime dependencies. The tarball contains only compiled JavaScript/declarations, this README, LICENSE and npm's package metadata. Publishing needs your normal npm authentication; this repository supplies no publishing automation.
