import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { AcceptInvite } from "@/components/auth/AcceptInvite";
import { Callout } from "@/components/ui/display";
import { inviteLinkState } from "@/lib/invitations";
import { getCurrentUser } from "@/lib/permissions";
import { roleLabel } from "@/lib/roles";

export const metadata: Metadata = { title: "Join a workspace", referrer: "no-referrer" };

const CLOSED = {
  ACCEPTED: { title: "This invitation was already used.", description: "Someone accepted it, so the link no longer works." },
  REVOKED: { title: "This invitation was withdrawn.", description: "An admin cancelled it before it was accepted." },
  EXPIRED: { title: "This invitation has expired.", description: "Invitations work for 7 days." },
  INVALID: { title: "This invitation isn't valid.", description: "It may have expired, been withdrawn or already been used." },
} as const;

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const link = await inviteLinkState(token);
  const user = await getCurrentUser();
  if (link.state !== "PENDING") {
    const copy = CLOSED[link.state];
    const who = link.state === "INVALID" ? "the person who invited you" : link.inviterName ?? `an admin of ${link.workspaceName}`;
    return (
      <AuthFrame centered title={copy.title} description={copy.description}>
        {link.state === "ACCEPTED" ? (
          <Callout tone="info">
            If it was you, {user ? <Link href="/" className="font-semibold underline underline-offset-4">open your workspaces</Link> : <Link href="/login" className="font-semibold underline underline-offset-4">sign in</Link>} to find {link.workspaceName}.
          </Callout>
        ) : (
          <Callout tone="info">
            Ask {who} to send a new invitation.{" "}
            <Link href={user ? "/" : "/login"} className="font-semibold underline underline-offset-4">{user ? "Go to your home page" : "Go to sign in"}</Link>
          </Callout>
        )}
      </AuthFrame>
    );
  }
  const { invitation } = link;
  const mode = user
    ? user.email.toLowerCase() === invitation.email.toLowerCase() ? "signed-in-match" : "signed-in-other"
    : invitation.existingAccount ? "existing" : "new";
  const inviter = invitation.invitedBy?.name?.trim();
  return (
    <AuthFrame
      title={`Join ${invitation.workspace.name}.`}
      description={`${inviter ? `${inviter} invited you` : "You're invited"} to join as ${roleLabel(invitation.role).toLowerCase()}.${invitation.workspace.tagline ? ` ${invitation.workspace.tagline}` : ""}`}
    >
      <AcceptInvite token={token} email={invitation.email} workspaceName={invitation.workspace.name} mode={mode} signedInAs={user?.email ?? null} />
    </AuthFrame>
  );
}
