// Generated from app/invite/[token]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { inviteLinkState } from "@/lib/invitations";
import { getCurrentUser } from "@/lib/permissions";
const CLOSED = {
  ACCEPTED: { title: "This invitation was already used.", description: "Someone accepted it, so the link no longer works." },
  REVOKED: { title: "This invitation was withdrawn.", description: "An admin cancelled it before it was accepted." },
  EXPIRED: { title: "This invitation has expired.", description: "Invitations work for 7 days." },
  INVALID: { title: "This invitation isn't valid.", description: "It may have expired, been withdrawn or already been used." },
} as const;
export async function loadInvitePage({ params }: PageProps<"/invite/[token]">) {
const { token } = await params;
const link = await inviteLinkState(token);
const user = await getCurrentUser();
return viewDto({ link, user } as const);
}
