"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";
import { setScopedDestinations } from "@/lib/notify";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { idSchema } from "@/lib/validation";
import { normalizeTags } from "@/lib/assistant/memory";
import { BUILTIN_SKILLS } from "@/lib/assistant/skills";
import { nextRunAt } from "@/lib/assistant/cron";
import { checkChannel, jobSchema } from "@/lib/assistant/job-validation";
import { runScheduledJob } from "@/lib/assistant/jobs";

/**
 * Assistant mutations: conversations (owner only), workspace memory, skills
 * and scheduled jobs (admins). Pattern: resolve the workspace from the slug →
 * role check → rate limit → zod → Prisma → audit → revalidate.
 */

const slugSchema = z.string().min(1).max(64);

async function context(slug: unknown, minRole: "MEMBER" | "ADMIN") {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const ctx = await getWorkspaceForAction(parsed.data, minRole, { module: "assistant" });
  if (!ctx || !canContribute(ctx.membership) || !hasRoleAtLeast(ctx.membership.role, minRole)) return null;
  return ctx;
}

const base = (slug: string) => `/w/${slug}/assistant`;

/* ───────────── Conversations ───────────── */

export async function createConversationAction(slug: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await context(slug, "MEMBER");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const conversation = await prisma.assistantConversation.create({ data: { workspaceId: ctx.workspace.id, userId: ctx.user.id }, select: { id: true } });
  revalidatePath(base(ctx.workspace.slug), "layout");
  return { ok: true, data: { id: conversation.id } };
}

const renameSchema = z.object({ conversationId: idSchema, title: z.string().trim().min(1, "Enter a title.").max(120) });

export async function renameConversationAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug, "MEMBER");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const updated = await prisma.assistantConversation.updateMany({
    where: { id: parsed.data.conversationId, workspaceId: ctx.workspace.id, userId: ctx.user.id },
    data: { title: parsed.data.title },
  });
  if (updated.count === 0) return actionError("That conversation isn't available.");
  revalidatePath(base(ctx.workspace.slug), "layout");
  return { ok: true };
}

export async function deleteConversationAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug, "MEMBER");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ conversationId: idSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const deleted = await prisma.assistantConversation.deleteMany({ where: { id: parsed.data.conversationId, workspaceId: ctx.workspace.id, userId: ctx.user.id } });
  if (deleted.count === 0) return actionError("That conversation isn't available.");
  revalidatePath(base(ctx.workspace.slug), "layout");
  return { ok: true };
}

/* ───────────── Workspace memory (admins) ───────────── */

const memorySchema = z.object({
  content: z.string().trim().min(3, "Write at least a few words.").max(1000, "Keep a memory under 1,000 characters."),
  tags: z.array(z.string().max(32)).max(8).default([]),
});

export async function createMemoryAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug, "ADMIN");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = memorySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const memory = await prisma.assistantMemory.create({
    data: { workspaceId: ctx.workspace.id, content: parsed.data.content, tags: normalizeTags(parsed.data.tags), createdById: ctx.user.id, source: "manual" },
    select: { id: true },
  });
  await recordAuditEvent({ action: "assistant.memory_saved", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "AssistantMemory", targetId: memory.id, metadata: { via: "settings" } });
  revalidatePath(`${base(ctx.workspace.slug)}/memory`);
  return { ok: true };
}

export async function updateMemoryAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug, "ADMIN");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = memorySchema.extend({ memoryId: idSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const updated = await prisma.assistantMemory.updateMany({
    where: { id: parsed.data.memoryId, workspaceId: ctx.workspace.id },
    data: { content: parsed.data.content, tags: normalizeTags(parsed.data.tags) },
  });
  if (updated.count === 0) return actionError("That memory was already removed.");
  await recordAuditEvent({ action: "assistant.memory_updated", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "AssistantMemory", targetId: parsed.data.memoryId });
  revalidatePath(`${base(ctx.workspace.slug)}/memory`);
  return { ok: true };
}

export async function deleteMemoryAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug, "ADMIN");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ memoryId: idSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const deleted = await prisma.assistantMemory.deleteMany({ where: { id: parsed.data.memoryId, workspaceId: ctx.workspace.id } });
  if (deleted.count === 0) return actionError("That memory was already removed.");
  await recordAuditEvent({ action: "assistant.memory_deleted", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "AssistantMemory", targetId: parsed.data.memoryId, metadata: { via: "settings" } });
  revalidatePath(`${base(ctx.workspace.slug)}/memory`);
  return { ok: true };
}

/* ───────────── Skills (admins) ───────────── */

const skillSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80),
  description: z.string().trim().min(1, "Say when the skill applies.").max(200),
  body: z.string().trim().min(1, "Write the playbook.").max(8000, "Keep a skill under 8,000 characters."),
  enabled: z.boolean().default(true),
});

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export async function createSkillAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug, "ADMIN");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = skillSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const skill = await prisma.assistantSkill.create({ data: { workspaceId: ctx.workspace.id, ...parsed.data, createdById: ctx.user.id }, select: { id: true } });
    await recordAuditEvent({ action: "assistant.skill_created", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "AssistantSkill", targetId: skill.id });
  } catch (error) {
    if (isUniqueViolation(error)) return actionError("A skill with that name already exists.", { name: ["Pick another name."] });
    throw error;
  }
  revalidatePath(`${base(ctx.workspace.slug)}/skills`);
  return { ok: true };
}

export async function updateSkillAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug, "ADMIN");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = skillSchema.extend({ skillId: idSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { skillId, ...data } = parsed.data;
  try {
    const updated = await prisma.assistantSkill.updateMany({ where: { id: skillId, workspaceId: ctx.workspace.id }, data });
    if (updated.count === 0) return actionError("That skill was removed.");
  } catch (error) {
    if (isUniqueViolation(error)) return actionError("A skill with that name already exists.", { name: ["Pick another name."] });
    throw error;
  }
  await recordAuditEvent({ action: "assistant.skill_updated", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "AssistantSkill", targetId: skillId, metadata: { enabled: data.enabled } });
  revalidatePath(`${base(ctx.workspace.slug)}/skills`);
  return { ok: true };
}

export async function deleteSkillAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug, "ADMIN");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ skillId: idSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const deleted = await prisma.assistantSkill.deleteMany({ where: { id: parsed.data.skillId, workspaceId: ctx.workspace.id } });
  if (deleted.count === 0) return actionError("That skill was already removed.");
  await recordAuditEvent({ action: "assistant.skill_deleted", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "AssistantSkill", targetId: parsed.data.skillId });
  revalidatePath(`${base(ctx.workspace.slug)}/skills`);
  return { ok: true };
}

/** Add the built-in skills that aren't in the workspace yet (by name). */
export async function installBuiltinSkillsAction(slug: string): Promise<ActionResult<{ added: number }>> {
  const ctx = await context(slug, "ADMIN");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const result = await prisma.assistantSkill.createMany({
    data: BUILTIN_SKILLS.map((skill) => ({ workspaceId: ctx.workspace.id, ...skill, enabled: true, createdById: ctx.user.id })),
    skipDuplicates: true,
  });
  await recordAuditEvent({ action: "assistant.skills_installed", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Workspace", targetId: ctx.workspace.id, metadata: { added: result.count } });
  revalidatePath(`${base(ctx.workspace.slug)}/skills`);
  return { ok: true, data: { added: result.count } };
}

/* ───────────── Scheduled jobs (admins) ───────────── */

export async function createJobAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await context(slug, "ADMIN");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { destinationIds, ...data } = parsed.data;
  if (!(await checkChannel(ctx.workspace.id, data.channelId))) return actionError("Pick a channel that still exists.", { channelId: ["Pick another channel."] });
  const job = await prisma.$transaction(async (tx) => {
    const row = await tx.scheduledJob.create({
      data: { workspaceId: ctx.workspace.id, ...data, createdById: ctx.user.id, nextRunAt: data.enabled ? nextRunAt(data.cron, data.timezone, new Date()) : null },
      select: { id: true },
    });
    await setScopedDestinations(tx, { workspaceId: ctx.workspace.id, scopeType: "DIGEST", scopeId: row.id, destinationIds, actorId: ctx.user.id, eventTypes: ["digest.ready"], name: data.name });
    await recordAuditEvent({ action: "assistant.job_created", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "ScheduledJob", targetId: row.id, client: tx });
    return row;
  });
  revalidatePath(`${base(ctx.workspace.slug)}/jobs`);
  return { ok: true, data: { id: job.id } };
}

export async function updateJobAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug, "ADMIN");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const jobId = idSchema.safeParse((input as { jobId?: unknown } | null)?.jobId);
  const parsed = jobSchema.safeParse(input);
  if (!jobId.success) return actionError("That job was removed.");
  if (!parsed.success) return validationError(parsed.error);
  const { destinationIds, ...data } = parsed.data;
  if (!(await checkChannel(ctx.workspace.id, data.channelId))) return actionError("Pick a channel that still exists.", { channelId: ["Pick another channel."] });
  const done = await prisma.$transaction(async (tx) => {
    const updated = await tx.scheduledJob.updateMany({
      where: { id: jobId.data, workspaceId: ctx.workspace.id },
      data: { ...data, nextRunAt: data.enabled ? nextRunAt(data.cron, data.timezone, new Date()) : null },
    });
    if (updated.count === 0) return false;
    await setScopedDestinations(tx, { workspaceId: ctx.workspace.id, scopeType: "DIGEST", scopeId: jobId.data, destinationIds, actorId: ctx.user.id, eventTypes: ["digest.ready"], name: data.name });
    await recordAuditEvent({ action: "assistant.job_updated", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "ScheduledJob", targetId: jobId.data, metadata: { enabled: data.enabled }, client: tx });
    return true;
  });
  if (!done) return actionError("That job was removed.");
  revalidatePath(`${base(ctx.workspace.slug)}/jobs`);
  return { ok: true };
}

export async function deleteJobAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug, "ADMIN");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ jobId: idSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const done = await prisma.$transaction(async (tx) => {
    const deleted = await tx.scheduledJob.deleteMany({ where: { id: parsed.data.jobId, workspaceId: ctx.workspace.id } });
    if (deleted.count === 0) return false;
    await setScopedDestinations(tx, { workspaceId: ctx.workspace.id, scopeType: "DIGEST", scopeId: parsed.data.jobId, destinationIds: [], actorId: ctx.user.id });
    await recordAuditEvent({ action: "assistant.job_deleted", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "ScheduledJob", targetId: parsed.data.jobId, client: tx });
    return true;
  });
  if (!done) return actionError("That job was already removed.");
  revalidatePath(`${base(ctx.workspace.slug)}/jobs`);
  return { ok: true };
}

/** Run a job now (does not move its schedule). */
export async function runJobNowAction(slug: string, input: unknown): Promise<ActionResult<{ status: string }>> {
  const ctx = await context(slug, "ADMIN");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("assistant", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ jobId: idSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const job = await prisma.scheduledJob.findFirst({ where: { id: parsed.data.jobId, workspaceId: ctx.workspace.id }, select: { id: true } });
  if (!job) return actionError("That job was removed.");
  await recordAuditEvent({ action: "assistant.job_run", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "ScheduledJob", targetId: job.id });
  const result = await runScheduledJob(job.id);
  revalidatePath(`${base(ctx.workspace.slug)}/jobs`);
  if (result.status !== "ok") return actionError(result.detail ?? "The job didn't finish. Try again.");
  return { ok: true, data: { status: result.status } };
}
