// Generated from app/account/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listCliSessions } from "@/lib/secrets/device";
import { getAuthSettings } from "@/lib/authSettings";
import { prisma } from "@/lib/db";
import { isOAuthProvider, OAUTH_ERROR_MESSAGES } from "@/lib/oauthLinking";
import { remainingRecoveryCodes } from "@/lib/mfa";
import { requireAuth } from "@/lib/permissions";
import { listUserWorkspaces } from "@/lib/workspaces";

export async function loadAccountPage({ searchParams }: PageProps<"/account">) {
const { error } = await searchParams;
const sessionUser = await requireAuth();
const [user, workspaces, remaining] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: sessionUser.id },
      select: { name: true, email: true, username: true, bio: true, pronouns: true, skills: true, timezone: true, passwordHash: true, mfaEnabledAt: true },
    }),
    listUserWorkspaces(sessionUser.id),
    remainingRecoveryCodes(sessionUser.id),
  ]);
const [settings, accounts] = await Promise.all([
    getAuthSettings().catch(() => null),
    prisma.account.findMany({ where: { userId: sessionUser.id }, select: { provider: true } }),
  ]);
const enabledProviders = (["google", "github", "apple"] as const).filter((p) => Boolean(settings?.[p]));
const linkedProviders = accounts.map((a) => a.provider).filter(isOAuthProvider);
const errorMessage = typeof error === "string" ? OAUTH_ERROR_MESSAGES[error] ?? "That sign-in couldn't be connected. Try again." : null;
const cliSessions = await listCliSessions(sessionUser.id);
const hasPassword = Boolean(user.passwordHash);
return viewDto({ user, workspaces, remaining, enabledProviders, linkedProviders, errorMessage, cliSessions, hasPassword } as const);
}
