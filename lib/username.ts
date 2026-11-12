/** Sign-in handles: lowercase, 3-30 characters, no "@" so they never look like an email. Pure and client-safe. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,29}$/;

export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "abuse", "account", "admin", "administrator", "anonymous", "api", "billing", "everyone", "help", "login", "logout", "me",
  "moderator", "noreply", "no-reply", "null", "owner", "postmaster", "root", "security", "signup", "space-works", "spaceworks",
  "staff", "support", "system", "team", "undefined", "webmaster", "workspace",
]);

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export type UsernameCheck = { ok: true; username: string } | { ok: false; error: string };

export function checkUsername(value: string): UsernameCheck {
  const username = normalizeUsername(value);
  if (username.includes("@")) return { ok: false, error: "A username can't contain @. Use letters, numbers, dots, dashes or underscores." };
  if (!USERNAME_PATTERN.test(username)) return { ok: false, error: "Use 3-30 lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number." };
  if (RESERVED_USERNAMES.has(username)) return { ok: false, error: "That username is reserved. Choose another." };
  return { ok: true, username };
}

/** The sign-in field takes either; anything containing "@" is treated as an email. */
export function parseIdentifier(value: string): { kind: "email" | "username"; value: string } {
  const normalized = value.trim().toLowerCase();
  return { kind: normalized.includes("@") ? "email" : "username", value: normalized };
}
