// Generated from app/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthSettings } from "@/lib/authSettings";
import { getInstanceSettings } from "@/lib/instanceSettings";
import { getCurrentUser, isSuperAdminEmail } from "@/lib/permissions";
import { homePathFor } from "@/lib/homePath";
import { isSetupOpen } from "@/lib/setup";
import { LAST_WORKSPACE_COOKIE } from "@/lib/workspaceCookie";
import { listUserWorkspaces } from "@/lib/workspaces";
import { listRequestsForUser } from "@/lib/orgRequests/service";

export async function loadHomeRedirect() {
if (await isSetupOpen()) redirect("/setup");
const user = await getCurrentUser();
const workspaces = user ? await listUserWorkspaces(user.id, { includeSuspended: true }) : [];
const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
const active = workspaces.filter((workspace) => workspace.status === "ACTIVE");
const home = user ? homePathFor({ isSuperAdmin: isSuperAdminEmail(user.email), workspaces: active, lastSlug: last }) : null;
if (home) redirect(home);
const suspended = workspaces.find((workspace) => workspace.status === "SUSPENDED");
if (suspended) redirect(`/w/${suspended.slug}/settings/plan`);
const allowSignup = user ? false : Boolean((await getAuthSettings().catch(() => null))?.allowSelfSignup);
const requireApproval = user ? (await getInstanceSettings(["workspaces.requireApproval"]))["workspaces.requireApproval"] !== "false" : true;
const superAdmin = user ? isSuperAdminEmail(user.email) : false;
const newOrgRequests = user ? (await listRequestsForUser(user.id, 10)).filter((request) => request.kind === "NEW_ORG") : [];
const pendingRequest = newOrgRequests.find((request) => request.status === "PENDING");
const rejectedRequest = pendingRequest ? undefined : newOrgRequests.find((request) => request.status === "REJECTED");
return viewDto({ user, allowSignup, requireApproval, superAdmin, pendingRequest, rejectedRequest } as const);
}
