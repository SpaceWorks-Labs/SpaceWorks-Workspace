import type { WorkspaceRole } from "@prisma/client";

/**
 * Pure role and capability rules (safe to import in client components and
 * unit tests). Server code checks these after `requireWorkspace` resolved the
 * membership from the database; UI visibility is never authorization.
 *
 * OWNER > ADMIN > MEMBER > GUEST.
 */
export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER", "GUEST"] as const;

const roleRank: Record<WorkspaceRole, number> = { GUEST: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function hasRoleAtLeast(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return roleRank[role] >= roleRank[min];
}

export function roleLabel(role: WorkspaceRole): string {
  return { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member", GUEST: "Guest" }[role];
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

/** Minimal shape the capability helpers need (a Membership row or a DTO). */
export type RoleHolder = { role: WorkspaceRole } | null | undefined;
type FinanceWorkspace = { financeVisibleToMembers: boolean };

const atLeast = (m: RoleHolder, min: WorkspaceRole) => m != null && hasRoleAtLeast(m.role, min);

/** Create and edit tasks, docs, files, messages. */
export const canContribute = (m: RoleHolder) => atLeast(m, "MEMBER");
/** Invite, change roles, suspend and remove members. */
export const canManageMembers = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageLabels = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageChannels = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageFinance = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageApiTokens = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageIntegrations = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canViewAuditLog = (m: RoleHolder) => atLeast(m, "ADMIN");
/** General workspace settings (name, timezone, currency, feature toggles). */
export const canManageWorkspace = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Delete the workspace or transfer ownership. */
export const canDeleteWorkspace = (m: RoleHolder) => atLeast(m, "OWNER");
export const canTransferOwnership = (m: RoleHolder) => atLeast(m, "OWNER");

/** Admins always see the kitty; members only when the workspace allows it; guests never. */
export function canViewFinance(m: RoleHolder, workspace: FinanceWorkspace): boolean {
  if (atLeast(m, "ADMIN")) return true;
  return atLeast(m, "MEMBER") && workspace.financeVisibleToMembers;
}

/**
 * Which roles an actor may assign. Only owners create owners or admins;
 * admins may move people between MEMBER and GUEST.
 */
export function assignableRoles(actor: RoleHolder): WorkspaceRole[] {
  if (atLeast(actor, "OWNER")) return ["OWNER", "ADMIN", "MEMBER", "GUEST"];
  if (atLeast(actor, "ADMIN")) return ["MEMBER", "GUEST"];
  return [];
}

/** Can `actor` change or remove a member who currently has `targetRole`? */
export function canActOnMember(actor: RoleHolder, targetRole: WorkspaceRole): boolean {
  if (!canManageMembers(actor)) return false;
  if (actor!.role === "OWNER") return true;
  // Admins manage members and guests, never other admins or owners.
  return targetRole === "MEMBER" || targetRole === "GUEST";
}

// ───────────── Platform extension capabilities ─────────────
// Role gates only. Record-level rules (team LEAD rights, vault grants,
// approval eligibility, PRIVATE/TEAM visibility) live in each area's lib and
// are checked after these.

type ServicesWorkspace = { membersCanAckIncidents: boolean };
type CostsWorkspace = { costsVisibleToMembers: boolean };

/** Teams: create, archive, change leads (team LEADs manage their own members). */
export const canManageTeams = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Onboarding/offboarding templates and starting offboarding runs. */
export const canManageOnboarding = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Emergency contacts: admins and the member themselves; every view is audited. */
export const canViewEmergencyContact = (m: RoleHolder, isSelf: boolean) => atLeast(m, "ADMIN") || (isSelf && atLeast(m, "GUEST"));

/** Services monitor: overview, monitors, incidents, cloud resources (guests get 404). */
export const canViewServices = (m: RoleHolder) => atLeast(m, "MEMBER");
/** Create/edit/pause monitors, maintenance windows, status page, manual incidents. */
export const canManageServices = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Acknowledge incidents: admins, plus members when the workspace allows it. */
export function canAckIncidents(m: RoleHolder, workspace: ServicesWorkspace): boolean {
  if (atLeast(m, "ADMIN")) return true;
  return atLeast(m, "MEMBER") && workspace.membersCanAckIncidents;
}
/** Connect or replace cloud provider credentials (write-only). */
export const canManageCloudAccounts = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Cloud spend and service costs: admins, members only when the workspace allows it. */
export function canViewCosts(m: RoleHolder, workspace: CostsWorkspace): boolean {
  if (atLeast(m, "ADMIN")) return true;
  return atLeast(m, "MEMBER") && workspace.costsVisibleToMembers;
}

/** Service catalogue: everyone but guests reads; admins (and owning-team leads) edit. */
export const canViewCatalogue = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canManageCatalogue = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canViewSubscriptions = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canManageSubscriptions = (m: RoleHolder) => atLeast(m, "ADMIN");

/** Open the vault (what each item shows still depends on grants). Guests never. */
export const canUseVault = (m: RoleHolder) => atLeast(m, "MEMBER");
/** Create collections and manage grants workspace-wide. */
export const canManageVault = (m: RoleHolder) => atLeast(m, "ADMIN");

/** Contacts and organisations: members view (per visibility) and add. */
export const canViewContacts = (m: RoleHolder) => atLeast(m, "MEMBER");
/** Delete, merge and bulk-export contacts. */
export const canManageContacts = (m: RoleHolder) => atLeast(m, "ADMIN");

/** Borrow and book equipment. */
export const canUseAssets = (m: RoleHolder) => atLeast(m, "MEMBER");
/** Inventory, maintenance, keys and access credentials. */
export const canManageAssets = (m: RoleHolder) => atLeast(m, "ADMIN");

/** Submit purchase requests and reimbursement claims. */
export const canSubmitRequests = (m: RoleHolder) => atLeast(m, "MEMBER");
/** Approval policies and the "all requests" view; deciding is per policy step. */
export const canManageApprovals = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Mark reimbursements paid and post them to the ledger. */
export const canPayRequests = (m: RoleHolder) => atLeast(m, "ADMIN");

/** Volunteer rota: sign up for shifts. */
export const canUseRota = (m: RoleHolder) => atLeast(m, "MEMBER");
/** Shift types and shifts (team leads manage their own team's shifts). */
export const canManageRota = (m: RoleHolder) => atLeast(m, "ADMIN");

/** Build forms and see every submission. */
export const canManageForms = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Record decisions and close motions (meeting facilitators may also record). */
export const canRecordDecisions = (m: RoleHolder) => atLeast(m, "ADMIN");

/** Notification destinations, workspace rules, delivery log, test sends. */
export const canManageNotificationRouting = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Pick external destinations in an entity's "Send to" picker (members: in-app/channel only). */
export const canPickExternalDestinations = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Slack/Discord/Mattermost/Telegram/WhatsApp connections and channel bridges. */
export const canManageMessaging = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Link one's own Telegram/Slack/… account (guests: not yet). */
export const canLinkExternalAccounts = (m: RoleHolder) => atLeast(m, "MEMBER");

/** Workspace-wide export (zip): admins and owners, like the other data controls (docs/areas/platform-shell.md). */
export const canExportWorkspace = (m: RoleHolder) => atLeast(m, "ADMIN");

/** App reviews: members triage and reply; admins manage store credentials. */
export const canViewAppReviews = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canManageAppReviews = (m: RoleHolder) => atLeast(m, "ADMIN");

/** Internal team operations: guests excluded; admins manage queues and reviews. */
export const canUseInternalOperations = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canManageInternalOperations = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Social: members read and answer; admins connect official accounts. */
export const canViewSocial = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canManageSocial = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canConnectSocial = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Legal, board and vendor banking records are restricted to workspace admins. */
export const canManageGovernance = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canViewGovernance = canManageGovernance;
/** Internal calendar scheduling; guests may only respond to invitations. */
export const canScheduleMeetings = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canManageCalendarDeadlines = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Payroll requires an explicit tenant grant; role alone never grants it. */
export type PayrollGrant = { manage: boolean } | null | undefined;
export const canViewPayroll = (m: ({ role: WorkspaceRole; viaSuperAdmin?: boolean }) | null | undefined, grant: PayrollGrant) =>
  atLeast(m, "MEMBER") && (m?.viaSuperAdmin === true || grant != null);
export const canManagePayroll = (m: ({ role: WorkspaceRole; viaSuperAdmin?: boolean }) | null | undefined, grant: PayrollGrant) =>
  canViewPayroll(m, grant) && (m?.viaSuperAdmin === true || grant?.manage === true);

/** Issued money documents and donor tax identities stay restricted to finance administrators. */
export const canIssueFinancialDocuments = (m: RoleHolder) => atLeast(m, "ADMIN");
/** HR letters use the existing internal-operations administrator role. */
export const canIssueLetters = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canCancelDocuments = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canManageDocumentSettings = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canExportDocumentFilings = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Funding includes donor identity and proof; only workspace admins read or edit. */
export const canManageFunding = (m: RoleHolder) => atLeast(m, "ADMIN");
export const canViewFunding = canManageFunding;
/** Internal cash, asset accounting and tax registers require finance management rights. */
export const canManageMoneyControls = (m: RoleHolder) => atLeast(m, "ADMIN");
/** People can acknowledge their own assignment or custodian handover. */
export function canReadMoneyControl(m: RoleHolder, userId: string, row: { kind: string; ownerId: string | null; createdById: string; details?: unknown }) {
 if (!atLeast(m,"MEMBER")) return false;
 if (canManageMoneyControls(m)) return true;
 const d = row.details && typeof row.details === "object" ? row.details as Record<string,unknown> : {};
 return ["HANDOVER","ASSIGNMENT"].includes(row.kind) && (row.ownerId === userId || d.outgoingId === userId);
}
/** Appointments grant no access to case contents without explicit case assignment. */
export const canManageSafeguardingHandlers = (m: RoleHolder) => atLeast(m, "OWNER");
export const canHandleSafeguarding = (m: RoleHolder, appointed: boolean, assigned: boolean) => atLeast(m, "MEMBER") && appointed && assigned;

/** Organisation tools are internal; structure and registers are maintained by admins. */
export const canViewOrgPeople = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canManageOrgPeople = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Attendance is personal, with direct-manager access. Admins cannot act on peers or owners. */
export function canRecordAttendance(m: RoleHolder, isSelf: boolean, isDirectManager: boolean, targetRole: WorkspaceRole) {
  return canViewOrgPeople(m) && (isSelf || (isDirectManager && targetRole === "MEMBER") || canActOnMember(m, targetRole));
}
/** Marketing planning is internal; approved brand assets are readable by members. */
export const canUseMarketingOperations = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canManageMarketingOperations = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Device assignments, incident details and access reviews are admin records. */
export const canManageItAdministration = (m: RoleHolder) => atLeast(m, "ADMIN");

/** Application secrets require active membership and explicit environment access. */
export const canUseSecrets = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canManageSecrets = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Internal product tools are for the operating team; funding estimates require finance management. */
export const canManageProductOps = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canManageProductEstimates = (m: RoleHolder) => atLeast(m, "ADMIN");

/** Publishing into the existing changelog retains its admin-only permission. */
export const canPublishProductChangelog = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Fixed costs are finance-manager tools; staff recovery also permits the person. */
export const canManageRecurringCosts = canManageFinance;
export const canReadStaffAdvance = (m: RoleHolder, grant: PayrollGrant, userId: string, personId: string) =>
  atLeast(m, "MEMBER") && (canManagePayroll(m, grant) || userId === personId);
/** Project plans and check-ins: project lead or workspace admins; guests read only. */
export function canManageProjectPlan(m: RoleHolder, userId: string, ownerId: string | null) {
  return atLeast(m, "ADMIN") || (atLeast(m, "MEMBER") && userId === ownerId);
}
export const canEditTaskPlan = (m: RoleHolder) => atLeast(m, "MEMBER");

/** Analytics retains each source tool’s record access checks. */
export const canViewAnalytics = (m: RoleHolder) => atLeast(m, "MEMBER");
export const canManageAnalytics = (m: RoleHolder) => atLeast(m, "ADMIN");
