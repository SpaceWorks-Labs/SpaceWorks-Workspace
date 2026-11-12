import "server-only";
import type { WorkspaceMembership } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { canManageCampaigns, canSendCampaigns } from "@/lib/campaigns/roles";
import { getCampaignSettings } from "@/lib/campaigns/settings";
import { usesSharedSmtp } from "@/lib/campaigns/limits";
import { listTemplates } from "@/lib/campaigns/campaigns/templates";

/** Everything the editor needs, resolved on the server for one workspace. */
export async function loadEditorData(workspace: { id: string; name: string }, membership: WorkspaceMembership) {
  const [lists, templates, settings, sharedSmtp] = await Promise.all([
    prisma.mailingList.findMany({ where: { workspaceId: workspace.id, archivedAt: null }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, _count: { select: { subscriptions: { where: { status: "CONFIRMED" } } } } } }),
    listTemplates(workspace.id),
    getCampaignSettings(workspace.id),
    usesSharedSmtp(workspace.id),
  ]);
  return {
    lists: lists.map((l) => ({ id: l.id, name: l.name, confirmed: l._count.subscriptions })),
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
    defaults: { fromName: workspace.name, templateId: templates.find((t) => t.isDefault)?.id ?? null },
    tracking: { trackOpens: settings.trackOpens, trackClicks: settings.trackClicks, individualTracking: settings.individualTracking },
    canSend: canSendCampaigns(membership),
    canHtml: canManageCampaigns(membership),
    sharedSmtp,
  };
}
