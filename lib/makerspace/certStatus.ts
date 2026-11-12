/** Pure sign-off status calculation (no database), shared by the matrix and its unit tests. */
export type SignoffStatus = "valid" | "expiring" | "expired" | "missing";
export type GrantLike = { expiresAt: Date | null; revokedAt: Date | null };
export const EXPIRY_WARNING_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Revoked grants never count. A grant with no expiry is always valid; otherwise the
 * latest expiry decides: still in the future is valid (expiring inside the warning
 * window), in the past is expired. No usable grant at all is missing.
 */
export function signoffStatus(grants: ReadonlyArray<GrantLike>, now: Date, warnDays = EXPIRY_WARNING_DAYS): { status: SignoffStatus; expiresAt: Date | null } {
  const live = grants.filter((grant) => !grant.revokedAt);
  if (!live.length) return { status: "missing", expiresAt: null };
  if (live.some((grant) => !grant.expiresAt)) return { status: "valid", expiresAt: null };
  const latest = live.reduce((best, grant) => (grant.expiresAt! > best ? grant.expiresAt! : best), live[0]!.expiresAt!);
  if (latest <= now) return { status: "expired", expiresAt: latest };
  return { status: latest.getTime() - now.getTime() <= warnDays * DAY_MS ? "expiring" : "valid", expiresAt: latest };
}

export const SIGNOFF_LABEL: Record<SignoffStatus, string> = { valid: "Signed off", expiring: "Expiring soon", expired: "Expired", missing: "Not signed off" };
export const isSignedOff = (status: SignoffStatus) => status === "valid" || status === "expiring";

export type MatrixRow = { userId: string; name: string; cells: Record<string, { status: SignoffStatus; expiresAt: Date | null }> };
export type SignoffMatrix = { types: { id: string; name: string }[]; rows: MatrixRow[]; full: boolean };

/** Cells that are expiring or expired, for the inductions panel callout. */
export const needsAttention = (matrix: SignoffMatrix) =>
  matrix.rows.flatMap((row) => Object.entries(row.cells).filter(([, c]) => c.status === "expiring" || c.status === "expired").map(([typeId, c]) => ({ name: row.name, typeId, status: c.status, expiresAt: c.expiresAt })));
