/** Sign-in, organisation and sign-up instance settings (key to secret flag and env fallback). */
export const AUTH_SETTING_KEYS = {
  "workspaces.requireApproval": { secret: false, env: "WORKSPACES_REQUIRE_APPROVAL" },
  "github.enabled": { secret: false, env: "AUTH_GITHUB_ENABLED" },
  "github.clientId": { secret: false, env: "AUTH_GITHUB_ID" },
  "github.clientSecret": { secret: true, env: "AUTH_GITHUB_SECRET" },
  "apple.enabled": { secret: false, env: "AUTH_APPLE_ENABLED" },
  "apple.clientId": { secret: false, env: "AUTH_APPLE_ID" },
  "apple.teamId": { secret: false, env: "AUTH_APPLE_TEAM_ID" },
  "apple.keyId": { secret: false, env: "AUTH_APPLE_KEY_ID" },
  "apple.privateKey": { secret: true, env: "AUTH_APPLE_PRIVATE_KEY" },
  "google.enabled": { secret: false, env: "AUTH_GOOGLE_ENABLED" },
  "auth.allowSelfSignup": { secret: false, env: "AUTH_ALLOW_SELF_SIGNUP" },
  "auth.allowedEmailDomains": { secret: false, env: "AUTH_ALLOWED_EMAIL_DOMAINS" },
} as const;
