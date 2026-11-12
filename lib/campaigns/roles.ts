import { hasRoleAtLeast } from "@/lib/roles";
import type { RoleHolder } from "@/lib/roles";

const atLeast = (m: RoleHolder, min: "ADMIN" | "MEMBER") => Boolean(m && hasRoleAtLeast(m.role, min));

/** View campaigns, create and edit drafts, send tests. */
export const canContributeCampaigns = (m: RoleHolder) => atLeast(m, "MEMBER");
/** Lists, subscribers, import/export, settings, template delete, bounce secret. */
export const canManageCampaigns = (m: RoleHolder) => atLeast(m, "ADMIN");
/** Schedule, send and cancel campaigns. */
export const canSendCampaigns = (m: RoleHolder) => atLeast(m, "ADMIN");
