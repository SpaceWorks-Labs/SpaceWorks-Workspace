import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { NoWorkspaceHome } from "@/components/home/NoWorkspaceHome";
import { getAuthSettings } from "@/lib/authSettings";
import { getInstanceSettings } from "@/lib/instanceSettings";
import { getCurrentUser, isSuperAdminEmail } from "@/lib/permissions";
import { homePathFor } from "@/lib/homePath";
import { isSetupOpen } from "@/lib/setup";
import { LAST_WORKSPACE_COOKIE } from "@/lib/workspaceCookie";
import { listUserWorkspaces } from "@/lib/workspaces";
import { listRequestsForUser } from "@/lib/orgRequests/service";

export const metadata: Metadata = {
  title: { absolute: "Space Works Workspace" },
  description: "The free, open-source, self-hosted workspace for the team that runs a maker organisation, NGO or community office.",
};

/**
 * Entry point: setup → signed out: the public landing page → signed in: last
 * (or first) workspace → "no workspace yet". Everything before the first JSX
 * statement is lifted into the generated loader (npm run frontend:catalog).
 */
export default async function HomeRedirect() {
  if (await isSetupOpen()) redirect("/setup");
  const user = await getCurrentUser();
  const workspaces = user ? await listUserWorkspaces(user.id, { includeSuspended: true }) : [];
  const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  const active = workspaces.filter((workspace) => workspace.status === "ACTIVE");
  // The instance super admin's home is the /admin console; everyone else lands on their last (or first) workspace.
  const home = user ? homePathFor({ isSuperAdmin: isSuperAdminEmail(user.email), workspaces: active, lastSlug: last }) : null;
  if (home) redirect(home);
  // Owners and admins of a suspended organisation can still open its plan page to see why and ask for help.
  const suspended = workspaces.find((workspace) => workspace.status === "SUSPENDED");
  if (suspended) redirect(`/w/${suspended.slug}/settings/plan`);

  const allowSignup = user ? false : Boolean((await getAuthSettings().catch(() => null))?.allowSelfSignup);
  const requireApproval = user ? (await getInstanceSettings(["workspaces.requireApproval"]))["workspaces.requireApproval"] !== "false" : true;
  const superAdmin = user ? isSuperAdminEmail(user.email) : false;
  const newOrgRequests = user ? (await listRequestsForUser(user.id, 10)).filter((request) => request.kind === "NEW_ORG") : [];
  const pendingRequest = newOrgRequests.find((request) => request.status === "PENDING");
  const rejectedRequest = pendingRequest ? undefined : newOrgRequests.find((request) => request.status === "REJECTED");
  if (!user) return <LandingPage allowSignup={allowSignup} />;
  return <NoWorkspaceHome email={user.email} superAdmin={superAdmin} pendingRequest={pendingRequest ?? null} rejectedRequest={rejectedRequest ?? null} requireApproval={requireApproval} />;
}
