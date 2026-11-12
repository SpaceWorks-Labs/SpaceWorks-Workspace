import "server-only";
import { prisma } from "@/lib/db";
import { auditCampaignEvent } from "@/lib/campaigns/audit";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { DEFAULT_TEMPLATE_HTML } from "@/lib/campaigns/render";
import { sanitizeCampaignHtml } from "@/lib/campaigns/sanitize";
import { templateSchema } from "@/lib/campaigns/campaigns/schemas";
import type { Actor } from "@/lib/campaigns/campaigns/crud";

export const BUILT_IN_TEMPLATE = { id: "built-in", name: "Default", bodyHtml: DEFAULT_TEMPLATE_HTML };

export async function listTemplates(workspaceId: string) {
  return prisma.emailTemplate.findMany({ where: { workspaceId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], take: 200 });
}

export async function saveTemplate(actor: Actor, id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = { ...parsed.data, bodyHtml: sanitizeCampaignHtml(parsed.data.bodyHtml), subject: parsed.data.subject || null };
  if (!data.bodyHtml.trim()) return actionError("The template has no usable HTML.");
  const saved = await prisma.$transaction(async (tx) => {
    if (id && !(await tx.emailTemplate.count({ where: { id, workspaceId: actor.workspaceId } }))) return null;
    if (data.isDefault) await tx.emailTemplate.updateMany({ where: { workspaceId: actor.workspaceId, isDefault: true, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
    return id
      ? tx.emailTemplate.update({ where: { id }, data, select: { id: true } })
      : tx.emailTemplate.create({ data: { ...data, workspaceId: actor.workspaceId, createdById: actor.userId }, select: { id: true } });
  });
  return saved ? { ok: true, data: { id: saved.id } } : actionError("That template no longer exists.");
}

export async function deleteTemplate(actor: Actor, id: string): Promise<ActionResult> {
  const res = await prisma.emailTemplate.deleteMany({ where: { id, workspaceId: actor.workspaceId } });
  if (!res.count) return actionError("That template no longer exists.");
  await auditCampaignEvent({ action: "template_deleted", workspaceId: actor.workspaceId, actorId: actor.userId, targetType: "EmailTemplate", targetId: id });
  return { ok: true };
}
