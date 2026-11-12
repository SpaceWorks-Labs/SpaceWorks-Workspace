"use server";
import { z } from "zod";
import { revalidatePath } from "@/lib/frontend/cache";
import { prisma } from "@/lib/db";
import { shellContext, searchActor } from "@/lib/shell/context";
import { findVisibleLink } from "@/lib/shell/links";
import { hasRoleAtLeast, canContribute } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import {
  indexSearchDocument,
  removeSearchDocument,
} from "@/lib/search/documents";
import { actionError, type ActionResult } from "@/lib/actionResult";
const schema = z.object({
  id: z.string().max(64).optional(),
  title: z.string().trim().min(1).max(200),
  url: z
    .url()
    .max(2000)
    .refine((value) => {
      const u = new URL(value);
      return (
        ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
      );
    }),
  description: z.string().trim().max(1000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});
export async function saveLink(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await shellContext(slug, "MEMBER", "apiWrite", "knowledge");
  if (!ctx || !canContribute(ctx.membership))
    return actionError("You don't have access to add links.");
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return actionError("Add a title and a valid http or https link.");
  const { id, ...data } = parsed.data;
  if (id) {
    const existing = await findVisibleLink(searchActor(ctx), id);
    if (
      !existing ||
      (existing.createdById !== ctx.user.id &&
        !hasRoleAtLeast(ctx.membership.role, "ADMIN"))
    )
      return actionError("You can't edit this link.");
  }
  try {
    await prisma.$transaction(async (tx) => {
      const row = id
        ? await tx.linkItem.update({
            where: { id, workspaceId: ctx.workspace.id },
            data,
          })
        : await tx.linkItem.create({
            data: {
              ...data,
              workspaceId: ctx.workspace.id,
              createdById: ctx.user.id,
            },
          });
      await indexSearchDocument(
        {
          workspaceId: ctx.workspace.id,
          entityType: "link",
          entityId: row.id,
          title: row.title,
          body: [row.description, ...row.tags].join(" "),
          url: `/w/${slug}/links#${row.id}`,
          teamId: row.teamId,
        },
        tx,
      );
      await recordActivity(
        {
          workspaceId: ctx.workspace.id,
          actorId: ctx.user.id,
          verb: id ? "updated" : "created",
          entityType: "link",
          entityId: row.id,
          summary: `${id ? "Updated" : "Added"} ${row.title}`,
          teamId: row.teamId,
        },
        tx,
      );
      await recordAuditEvent({
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        action: id ? "shell.link_updated" : "shell.link_created",
        targetId: row.id,
        targetType: "LinkItem",
        client: tx,
      });
    });
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true };
  } catch {
    return actionError("Couldn't save the link. Try again.");
  }
}
export async function linkState(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await shellContext(slug, "GUEST", "apiWrite", "knowledge");
  const parsed = z
    .object({
      id: z.string().min(1).max(64),
      operation: z.enum(["pin", "unpin", "delete"]),
    })
    .safeParse(input);
  if (!ctx || !parsed.success)
    return actionError("Couldn't update the link. Try again.");
  const { id, operation } = parsed.data;
  const row = await findVisibleLink(searchActor(ctx), id);
  if (!row) return actionError("This link is unavailable.");
  if (
    operation === "delete" &&
    (!canContribute(ctx.membership) ||
      (row.createdById !== ctx.user.id &&
        !hasRoleAtLeast(ctx.membership.role, "ADMIN")))
  )
    return actionError("You can't remove this link.");
  try {
    await prisma.$transaction(async (tx) => {
      const key = {
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        entityType: "link",
        entityId: id,
      };
      if (operation === "pin")
        await tx.bookmark.upsert({
          where: { workspaceId_userId_entityType_entityId: key },
          create: key,
          update: {},
        });
      else if (operation === "unpin")
        await tx.bookmark.deleteMany({ where: key });
      else {
        await tx.linkItem.deleteMany({
          where: { id, workspaceId: ctx.workspace.id },
        });
        await tx.bookmark.deleteMany({
          where: {
            workspaceId: ctx.workspace.id,
            entityType: "link",
            entityId: id,
          },
        });
        await removeSearchDocument("link", id, tx);
      }
      await recordAuditEvent({
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        action: `shell.link_${operation}`,
        targetId: id,
        client: tx,
      });
    });
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true };
  } catch {
    return actionError("Couldn't update the link. Try again.");
  }
}
