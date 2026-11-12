import "server-only";

import bcrypt from "bcryptjs";

// Fixed, non-secret bcrypt hash: equal work for unknown and Google-only accounts.
const DUMMY_HASH = "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";

/** bcrypt compare that spends the same time whether or not the account has a password. */
export async function comparePassword(password: string, hash: string | null | undefined) {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return Boolean(hash) && ok;
}
