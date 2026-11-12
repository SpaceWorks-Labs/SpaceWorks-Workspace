import { CliSessions } from "@/components/secrets/CliSessions";
import { listCliSessions } from "@/lib/secrets/device";
import type { Metadata } from "next";
import { SimpleShell } from "@/components/chrome/SimpleShell";
import { AppearanceCard } from "@/components/account/AppearanceCard";
import { ConnectedAccountsCard } from "@/components/account/ConnectedAccountsCard";
import { UsernameForm } from "@/components/account/UsernameForm";
import { MfaCard } from "@/components/account/MfaCard";
import { PasswordForm } from "@/components/account/PasswordForm";
import { ProfileForm } from "@/components/account/ProfileForm";
import { SessionsCard } from "@/components/account/SessionsCard";
import { Button } from "@/components/ui/button";
import { Callout, Card, PageHeader, SettingsRow } from "@/components/ui/display";
import { getAuthSettings } from "@/lib/authSettings";
import { prisma } from "@/lib/db";
import { isOAuthProvider, OAUTH_ERROR_MESSAGES } from "@/lib/oauthLinking";
import { remainingRecoveryCodes } from "@/lib/mfa";
import { requireAuth } from "@/lib/permissions";
import { roleLabel } from "@/lib/roles";
import { listUserWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
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
  return (
    <SimpleShell>
      <div className="flex flex-col gap-6">
        <PageHeader title="Your account" description={user.email} />
        {errorMessage ? <Callout tone="danger" role="alert">{errorMessage}</Callout> : null}
        <Card padding="lg">
          <SettingsRow title="Profile" description="How the crew sees you across every workspace.">
            <ProfileForm initial={{ name: user.name ?? "", pronouns: user.pronouns ?? "", bio: user.bio ?? "", skills: user.skills, timezone: user.timezone ?? "" }} />
          </SettingsRow>
          <SettingsRow title="Username" description="An alternative to your email when you sign in.">
            <UsernameForm initial={user.username ?? ""} />
          </SettingsRow>
          <SettingsRow title="Connected accounts" description="Sign in with Google, GitHub or Apple. Connecting needs a recent sign-in, and you always keep one way in.">
            <ConnectedAccountsCard enabled={enabledProviders} linked={linkedProviders} />
          </SettingsRow>
          <SettingsRow title="Password" description={hasPassword ? "Changing it signs you out on every device." : "You sign in with a connected account. Add a password as a fallback."}>
            <PasswordForm hasPassword={hasPassword} />
          </SettingsRow>
          <SettingsRow title="Two-step verification" description="A code from your phone at every sign-in.">
            <div id="two-step" className="scroll-mt-24"><MfaCard enabled={Boolean(user.mfaEnabledAt)} remainingCodes={remaining} /></div>
          </SettingsRow>
          <SettingsRow title="Appearance" description="Saved in this browser only.">
            <AppearanceCard />
          </SettingsRow>
          <SettingsRow title="Sessions" description="Lost a device? Sign out of every session at once.">
            <SessionsCard />
          </SettingsRow>
          <SettingsRow title="CLI devices" description="Devices authorised to use application Secrets. Revocation takes effect immediately.">
            <CliSessions sessions={cliSessions} timezone={user.timezone ?? "Asia/Kolkata"} />
          </SettingsRow>
          <SettingsRow title="Your data" description="A JSON copy of your profile, memberships, tasks, messages, docs.">
            <Button asChild variant="secondary">
              <a href="/api/account/export" download>Download my data</a>
            </Button>
          </SettingsRow>
          <SettingsRow title="Workspaces" description="Where you're a member, and organisations you've asked for.">
            <div className="flex flex-col gap-4">
              {workspaces.length === 0 ? (
                <p className="text-body-ui text-ink-muted">You aren&apos;t in any workspace yet. Ask an admin for an invitation, or start your own organisation.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {workspaces.map((workspace) => (
                    <li key={workspace.id} className="flex items-center justify-between gap-3">
                      <a href={`/w/${workspace.slug}`} className="font-semibold text-ink underline-offset-4 hover:underline">{workspace.name}</a>
                      <span className="text-caption text-ink-muted">{roleLabel(workspace.role)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Button asChild variant="secondary" className="self-start">
                <a href="/account/organisations">Request a new organisation</a>
              </Button>
            </div>
          </SettingsRow>
        </Card>
      </div>
    </SimpleShell>
  );
}
