import { decodeAes256Key, encryptWithKey, decryptWithKey, vaultRootKeys } from "../scripts/vault-root-crypto.mjs";
export { decodeAes256Key, encryptWithKey, decryptWithKey, vaultRootKeys };
import crypto from "crypto";

/**
 * Shared crypto helpers. Bearer capabilities (invite, reset, API tokens) are
 * random and stored only as SHA-256 hashes; configuration secrets are
 * AES-256-GCM encrypted with a domain-separated HKDF subkey so ciphertext
 * from one purpose can never be decrypted as another.
 */

/** URL-safe random token with `bytes` of entropy (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time comparison of two strings (false on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function hmacHex(key: string | Buffer, value: string): string {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest("hex");
}

/** Decode a base64 env value that must be exactly 32 bytes. */
/** Purposes for derived subkeys. Never reuse one purpose for another kind of data. */
export type SecretPurpose =
  | "social-access"
  | "social-refresh"
  | "social-oauth"
  | "social-draft"
  | "safeguarding-details"
  | "safeguarding-event"
  | "governance-vendor-bank"
  | "finance-pay-pan"
  | "finance-pay-bank"
  | "instance-settings"
  | "integration-tokens"
  /** MessagingConnection.credentialsEnc, BridgedChannel.outboundWebhookEnc. */
  | "messaging-credentials"
  /** NotificationDestination.secretEnc (webhook URLs, signing secrets). */
  | "notification-secrets"
  /** CloudConnection.credentialsEnc. */
  | "cloud-credentials"
  /** Monitor.secretEnc (auth headers, connection strings). */
  | "monitor-secrets"
  /** MemberProfile.emergencyContactEnc. */
  | "member-emergency"
  /** SsoProvider.clientSecretEnc. */
  | "sso-secrets"
  | "app-review-issuer"
  | "app-review-key-id"
  | "app-review-private-key"
  | "app-review-service-account"
  | "app-review-account-proxy"
  | "app-review-app-proxy"
  | "app-review-slack-token"
  | "app-review-slack-signing"
  /** WorkspaceEmailSettings.passwordEnc. */
  | "workspace-smtp"
  /** PaymentProviderAccount.credentialsEnc. */
  | "payment-credentials"
  /** WorkspaceAnalyticsConnection.secretEnc. */
  | "workspace-analytics"
  /** Campaign link and unsubscribe tokens. */
  | "campaign.link"
  /** CampaignSettings.bounceWebhookSecretEnc and bounce tokens. */
  | "campaign.bounce";

const PURPOSE_INFO: Record<SecretPurpose, string> = {
  "safeguarding-details":"sww-safeguarding-details-v1",
  "safeguarding-event":"sww-safeguarding-event-v1",
  "social-access": "sww-social-access-v1",
  "social-refresh": "sww-social-refresh-v1",
  "social-oauth": "sww-social-oauth-v1",
  "social-draft": "sww-social-draft-v1",
  "governance-vendor-bank": "sww-governance-vendor-bank-v1",
  "finance-pay-pan": "sww-finance-pay-pan-v1",
  "finance-pay-bank": "sww-finance-pay-bank-v1",
  "app-review-issuer": "sww-app-review-issuer-v1",
  "app-review-key-id": "sww-app-review-key-id-v1",
  "app-review-private-key": "sww-app-review-private-key-v1",
  "app-review-service-account": "sww-app-review-service-account-v1",
  "app-review-account-proxy": "sww-app-review-account-proxy-v1",
  "app-review-app-proxy": "sww-app-review-app-proxy-v1",
  "app-review-slack-token": "sww-app-review-slack-token-v1",
  "app-review-slack-signing": "sww-app-review-slack-signing-v1",

  "instance-settings": "sww-instance-settings-v1",
  "integration-tokens": "sww-integration-tokens-v1",
  "messaging-credentials": "sww-messaging-credentials-v1",
  "notification-secrets": "sww-notification-secrets-v1",
  "cloud-credentials": "sww-cloud-credentials-v1",
  "monitor-secrets": "sww-monitor-secrets-v1",
  "member-emergency": "sww-member-emergency-v1",
  "sso-secrets": "sww-sso-secrets-v1",
  "workspace-smtp": "sww-workspace-smtp-v1",
  "payment-credentials": "sww-payment-credentials-v1",
  "workspace-analytics": "sww-workspace-analytics-v1",
  "campaign.link": "sww-campaign-link-v1",
  "campaign.bounce": "sww-campaign-bounce-v1",
};

/** Third-party credentials use INTEGRATION_ENCRYPTION_KEY when set. */
const INTEGRATION_PURPOSES = new Set<SecretPurpose>(["integration-tokens", "messaging-credentials", "notification-secrets", "cloud-credentials", "monitor-secrets", "sso-secrets", "workspace-smtp", "payment-credentials", "workspace-analytics", "campaign.bounce"]);

function rootKeyFor(purpose: SecretPurpose): Buffer {
  if ((purpose.startsWith("social-") || purpose.startsWith("app-review-") || INTEGRATION_PURPOSES.has(purpose)) && process.env.INTEGRATION_ENCRYPTION_KEY) {
    return decodeAes256Key(process.env.INTEGRATION_ENCRYPTION_KEY, "INTEGRATION_ENCRYPTION_KEY");
  }
  return decodeAes256Key(process.env.MFA_ENCRYPTION_KEY, "MFA_ENCRYPTION_KEY");
}

function subkey(purpose: SecretPurpose): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", rootKeyFor(purpose), Buffer.alloc(0), PURPOSE_INFO[purpose], 32));
}

/** Encrypt a configuration secret (SMTP password, AI key, OAuth token…). */
export function encryptSecret(purpose: SecretPurpose, plaintext: string): string {
  return encryptWithKey(subkey(purpose), plaintext);
}

export function decryptSecret(purpose: SecretPurpose, value: string): string {
  return decryptWithKey(subkey(purpose), value);
}

/**
 * Envelope encryption for the credentials vault. A fresh 256-bit data key
 * encrypts the secret; the data key is wrapped with the vault master key
 * (VAULT_MASTER_KEY, separate from every other key). Store both strings and
 * the key version. Not end-to-end: the server can decrypt on reveal.
 */
export function openLegacyVaultEnvelope(sealed: { secretEnc: string; dataKeyEnc: string }): string {
  for (const root of vaultRootKeys()) { try { return openEnvelope(root.key, sealed); } catch {} }
  throw new Error("The legacy vault envelope cannot be opened.");
}
export function vaultMasterKey(raw?: string): Buffer {
  if (raw === undefined) return vaultRootKeys()[0].key;
  if (!raw) throw new Error("VAULT_MASTER_KEY is not set.");
  return decodeAes256Key(raw, "VAULT_MASTER_KEY");
}

export function sealEnvelope(masterKey: Buffer, plaintext: string): { secretEnc: string; dataKeyEnc: string } {
  const dataKey = crypto.randomBytes(32);
  return { secretEnc: encryptWithKey(dataKey, plaintext), dataKeyEnc: encryptWithKey(masterKey, dataKey.toString("base64")) };
}

export function openEnvelope(masterKey: Buffer, sealed: { secretEnc: string; dataKeyEnc: string }): string {
  const dataKey = Buffer.from(decryptWithKey(masterKey, sealed.dataKeyEnc), "base64");
  return decryptWithKey(dataKey, sealed.secretEnc);
}
