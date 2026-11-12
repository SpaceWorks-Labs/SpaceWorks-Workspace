import { describe, expect, it } from "vitest";
import {
  canAckIncidents,
  canExportWorkspace,
  canLinkExternalAccounts,
  canManageApprovals,
  canManageAssets,
  canManageCatalogue,
  canManageCloudAccounts,
  canManageContacts,
  canManageForms,
  canManageMessaging,
  canManageNotificationRouting,
  canManageOnboarding,
  canManageRota,
  canManageServices,
  canManageSubscriptions,
  canManageTeams,
  canManageVault,
  canPayRequests,
  canPickExternalDestinations,
  canRecordDecisions,
  canSubmitRequests,
  canUseAssets,
  canUseRota,
  canUseVault,
  canViewCatalogue,
  canViewContacts,
  canViewCosts,
  canViewEmergencyContact,
  canViewServices,
  canViewSubscriptions,
  assignableRoles,
  canActOnMember,
  canContribute,
  canDeleteWorkspace,
  canManageChannels,
  canManageFinance,
  canManageMembers,
  canManageWorkspace,
  canViewFinance,
  hasRoleAtLeast,
  isWorkspaceRole,
} from "@/lib/roles";

const owner = { role: "OWNER" as const };
const admin = { role: "ADMIN" as const };
const member = { role: "MEMBER" as const };
const guest = { role: "GUEST" as const };

describe("role ranking", () => {
  it("orders OWNER > ADMIN > MEMBER > GUEST", () => {
    expect(hasRoleAtLeast("OWNER", "ADMIN")).toBe(true);
    expect(hasRoleAtLeast("ADMIN", "MEMBER")).toBe(true);
    expect(hasRoleAtLeast("MEMBER", "GUEST")).toBe(true);
    expect(hasRoleAtLeast("GUEST", "MEMBER")).toBe(false);
    expect(hasRoleAtLeast("MEMBER", "ADMIN")).toBe(false);
    expect(hasRoleAtLeast("ADMIN", "OWNER")).toBe(false);
    expect(hasRoleAtLeast("GUEST", "GUEST")).toBe(true);
  });

  it("recognises role strings", () => {
    expect(isWorkspaceRole("ADMIN")).toBe(true);
    expect(isWorkspaceRole("admin")).toBe(false);
    expect(isWorkspaceRole(undefined)).toBe(false);
  });
});

describe("capabilities", () => {
  it("lets members contribute but not guests", () => {
    expect(canContribute(member)).toBe(true);
    expect(canContribute(guest)).toBe(false);
    expect(canContribute(null)).toBe(false);
  });

  it("reserves management to admins and owners", () => {
    for (const check of [canManageMembers, canManageFinance, canManageChannels, canManageWorkspace]) {
      expect(check(owner)).toBe(true);
      expect(check(admin)).toBe(true);
      expect(check(member)).toBe(false);
      expect(check(guest)).toBe(false);
      expect(check(undefined)).toBe(false);
    }
  });

  it("reserves deletion to owners", () => {
    expect(canDeleteWorkspace(owner)).toBe(true);
    expect(canDeleteWorkspace(admin)).toBe(false);
  });

  it("shows finance to admins always, members only when allowed, guests never", () => {
    const hidden = { financeVisibleToMembers: false };
    const shown = { financeVisibleToMembers: true };
    expect(canViewFinance(admin, hidden)).toBe(true);
    expect(canViewFinance(member, hidden)).toBe(false);
    expect(canViewFinance(member, shown)).toBe(true);
    expect(canViewFinance(guest, shown)).toBe(false);
    expect(canViewFinance(null, shown)).toBe(false);
  });
});

describe("member management rules", () => {
  it("only owners assign owner or admin", () => {
    expect(assignableRoles(owner)).toEqual(["OWNER", "ADMIN", "MEMBER", "GUEST"]);
    expect(assignableRoles(admin)).toEqual(["MEMBER", "GUEST"]);
    expect(assignableRoles(member)).toEqual([]);
  });

  it("admins act on members and guests only", () => {
    expect(canActOnMember(admin, "MEMBER")).toBe(true);
    expect(canActOnMember(admin, "GUEST")).toBe(true);
    expect(canActOnMember(admin, "ADMIN")).toBe(false);
    expect(canActOnMember(admin, "OWNER")).toBe(false);
    expect(canActOnMember(owner, "OWNER")).toBe(true);
    expect(canActOnMember(member, "GUEST")).toBe(false);
  });
});

describe("platform extension capabilities", () => {
  it("keeps admin-only management with admins and owners", () => {
    for (const check of [
      canManageTeams,
      canManageOnboarding,
      canManageServices,
      canManageCloudAccounts,
      canManageCatalogue,
      canManageSubscriptions,
      canManageVault,
      canManageContacts,
      canManageAssets,
      canManageApprovals,
      canPayRequests,
      canManageRota,
      canManageForms,
      canRecordDecisions,
      canManageNotificationRouting,
      canPickExternalDestinations,
      canManageMessaging,
    ]) {
      expect(check(owner)).toBe(true);
      expect(check(admin)).toBe(true);
      expect(check(member)).toBe(false);
      expect(check(guest)).toBe(false);
      expect(check(null)).toBe(false);
    }
  });

  it("opens member areas to members but never to guests", () => {
    for (const check of [canViewServices, canViewCatalogue, canViewSubscriptions, canUseVault, canViewContacts, canUseAssets, canSubmitRequests, canUseRota, canLinkExternalAccounts]) {
      expect(check(member)).toBe(true);
      expect(check(admin)).toBe(true);
      expect(check(guest)).toBe(false);
      expect(check(undefined)).toBe(false);
    }
  });

  it("lets members acknowledge incidents and see costs only when the workspace allows it", () => {
    expect(canAckIncidents(admin, { membersCanAckIncidents: false })).toBe(true);
    expect(canAckIncidents(member, { membersCanAckIncidents: false })).toBe(false);
    expect(canAckIncidents(member, { membersCanAckIncidents: true })).toBe(true);
    expect(canAckIncidents(guest, { membersCanAckIncidents: true })).toBe(false);
    expect(canViewCosts(admin, { costsVisibleToMembers: false })).toBe(true);
    expect(canViewCosts(member, { costsVisibleToMembers: false })).toBe(false);
    expect(canViewCosts(member, { costsVisibleToMembers: true })).toBe(true);
    expect(canViewCosts(guest, { costsVisibleToMembers: true })).toBe(false);
  });

  it("shows emergency contacts to admins and the member themselves only", () => {
    expect(canViewEmergencyContact(admin, false)).toBe(true);
    expect(canViewEmergencyContact(member, true)).toBe(true);
    expect(canViewEmergencyContact(guest, true)).toBe(true);
    expect(canViewEmergencyContact(member, false)).toBe(false);
    expect(canViewEmergencyContact(null, true)).toBe(false);
  });

  it("allows workspace export to admins and owners, as the export page and actions do", () => {
    expect(canExportWorkspace(owner)).toBe(true);
    expect(canExportWorkspace(admin)).toBe(true);
    expect(canExportWorkspace(member)).toBe(false);
  });
});
