import "server-only";

import { prisma } from "@/lib/db";
import { checkRateLimitById } from "@/lib/rateLimit";
import { verifyCampaignToken } from "../tokens";
import { getCampaignSettings } from "../settings";
import { subscribeToList } from "../subscriptions";
import { unsubscribeFromLists } from "./unsubscribe";
import { resolvePublicWorkspace } from "./gate";

export type PreferencesView = {
  workspaceId: string;
  workspaceName: string;
  subscriberId: string;
  name: string | null;
  blocklisted: boolean;
  lists: { id: string; name: string; description: string | null; subscribed: boolean; pending: boolean }[];
};

/** The subscriber's public-list choices. Private lists never appear, and neither does the email address. */
export async function loadPreferences(token: string): Promise<PreferencesView | null> {
  const payload = verifyCampaignToken(token, "prefs");
  if (!payload?.subscriberId) return null;
  const workspace = await resolvePublicWorkspace({ id: payload.workspaceId });
  if (!workspace) return null;
  const subscriber = await prisma.subscriber.findFirst({ where: { id: payload.subscriberId, workspaceId: workspace.id }, select: { id: true, name: true, status: true } });
  if (!subscriber) return null;
  const [lists, subs] = await Promise.all([
    prisma.mailingList.findMany({ where: { workspaceId: workspace.id, visibility: "PUBLIC", archivedAt: null }, orderBy: { name: "asc" }, take: 100 }),
    prisma.listSubscription.findMany({ where: { workspaceId: workspace.id, subscriberId: subscriber.id } }),
  ]);
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    subscriberId: subscriber.id,
    name: subscriber.name,
    blocklisted: subscriber.status === "BLOCKLISTED",
    lists: lists.map((l) => {
      const sub = subs.find((s) => s.listId === l.id);
      return { id: l.id, name: l.name, description: l.description, subscribed: sub?.status === "CONFIRMED", pending: sub?.status === "UNCONFIRMED" };
    }),
  };
}

/**
 * Apply the preferences form: edit the name and flip public-list subscriptions.
 * Turning a list on goes through the normal subscribe path, so DOUBLE lists
 * still send a confirmation email. Returns false when rate limited or invalid.
 */
export async function savePreferences(token: string, input: { name: string; subscribedListIds: string[] }, ip: string): Promise<boolean> {
  const view = await loadPreferences(token);
  if (!view || view.blocklisted) return false;
  if (!(await checkRateLimitById("campaignPublic", `prefs:${view.subscriberId}`)) || !(await checkRateLimitById("campaignPublic", `prefs-ip:${ip}`))) return false;
  const wanted = new Set(input.subscribedListIds);
  const name = input.name.trim().slice(0, 160);
  await prisma.subscriber.updateMany({ where: { id: view.subscriberId, workspaceId: view.workspaceId }, data: { name: name || null } });
  const subscriber = await prisma.subscriber.findUniqueOrThrow({ where: { id: view.subscriberId }, select: { email: true } });
  const settings = await getCampaignSettings(view.workspaceId);
  const off = view.lists.filter((l) => (l.subscribed || l.pending) && !wanted.has(l.id)).map((l) => l.id);
  if (off.length) await unsubscribeFromLists({ workspaceId: view.workspaceId, subscriberId: view.subscriberId, listIds: off }, "preferences");
  for (const l of view.lists.filter((x) => !x.subscribed && !x.pending && wanted.has(x.id))) {
    const list = await prisma.mailingList.findFirst({ where: { id: l.id, workspaceId: view.workspaceId, visibility: "PUBLIC", archivedAt: null } });
    if (list) await subscribeToList({ workspaceId: view.workspaceId, workspaceName: view.workspaceName, list, email: subscriber.email, source: "PREFERENCES", consentText: `Subscribed to "${list.name}" on the preferences page.`, ip: ip === "unknown" ? null : ip, recordConsentIp: settings.recordConsentIp });
  }
  return true;
}
