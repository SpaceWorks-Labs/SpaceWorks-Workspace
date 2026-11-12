import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { publish } from "@/lib/realtime";
import { hasRoleAtLeast } from "@/lib/roles";
import { runAgentLoop, systemBlocks } from "@/lib/assistant/agent";
import { createAnthropicClient, getAssistantConfig, messageText, usageTotals } from "@/lib/assistant/client";
import { digestFrequency, nextRunAt } from "@/lib/assistant/cron";
import { effectiveJobRole, type Principal } from "@/lib/assistant/principal";
import { buildRequestContext, buildStableSystemPrompt } from "@/lib/assistant/prompt";
import { toolsForWorkspace } from "@/lib/assistant/tools";
import { assertAssistantAllowed, recordAssistantUsage } from "@/lib/assistant/usage";

/**
 * Scheduled assistant jobs (ScheduledJob). Each due job is claimed with a
 * conditional update on `nextRunAt`, so replicas never run it twice. A run
 * uses the cheaper job model with read-only tools, as its creator but with
 * member-level rights at most, then posts the answer as an ASSISTANT message
 * to the job's channel, keeps it in the creator's "Scheduled: <name>"
 * conversation, and dispatches `digest.ready` (the job's "Send to"
 * destinations, scope `digestId`) plus `assistant.job.completed` to the creator.
 */

const MAX_JOBS_PER_TICK = 3;
const MAX_POST_CHARS = 8000;

export type JobRunResult = { status: "ok" | "failed" | "skipped"; detail?: string; text?: string };

function conversationTitleFor(jobName: string) {
  return `Scheduled: ${jobName}`.slice(0, 120);
}

export async function runScheduledJob(jobId: string, now = new Date()): Promise<JobRunResult> {
  const job = await prisma.scheduledJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      name: true,
      cron: true,
      prompt: true,
      channelId: true,
      createdById: true,
      workspace: { select: { id: true, slug: true, name: true, timezone: true, currency: true, financeVisibleToMembers: true, archivedAt: true, status: true } },
    },
  });
  if (!job || job.workspace.archivedAt || job.workspace.status !== "ACTIVE") return { status: "skipped", detail: "Job not found." };
  const finish = (result: JobRunResult) =>
    prisma.scheduledJob.update({ where: { id: job.id }, data: { lastStatus: result.status === "ok" ? "ok" : `${result.status}: ${result.detail ?? ""}`.slice(0, 200), lastRunAt: now } }).then(() => result);

  const config = await getAssistantConfig();
  if (!config) return finish({ status: "skipped", detail: "The assistant is not configured." });
  const allowed = await assertAssistantAllowed(job.workspace.id);
  if (!allowed.ok) return finish({ status: "skipped", detail: allowed.error });
  const membership = job.createdById
    ? await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: job.createdById, workspaceId: job.workspace.id } },
        select: { role: true, status: true, user: { select: { name: true, disabledAt: true } } },
      })
    : null;
  if (!job.createdById || !membership || membership.status !== "ACTIVE" || membership.user.disabledAt || !hasRoleAtLeast(membership.role, "MEMBER")) {
    await prisma.scheduledJob.update({ where: { id: job.id }, data: { enabled: false } });
    return finish({ status: "skipped", detail: "The job's creator is no longer an active member; the job was paused." });
  }

  const { archivedAt: _archived, ...workspace } = job.workspace;
  void _archived;
  const principal: Principal = { kind: "job", workspace, userId: job.createdById, userName: membership.user.name, role: effectiveJobRole(membership.role) };
  const skills = await prisma.assistantSkill.findMany({ where: { workspaceId: workspace.id, enabled: true }, orderBy: { name: "asc" }, select: { name: true, description: true, body: true } });

  let text = "";
  const usage = { tokensIn: 0, tokensOut: 0 };
  try {
    const outcome = await runAgentLoop({
      client: createAnthropicClient(config.apiKey),
      model: config.jobModel,
      effort: "low",
      maxTokens: 8000,
      system: systemBlocks(
        buildStableSystemPrompt({ workspaceName: workspace.name, mode: "job", skills }),
        buildRequestContext({ userName: principal.userName, role: principal.role, now, timeZone: workspace.timezone }),
      ),
      tools: await toolsForWorkspace(principal, { includeWrites: false }),
      messages: [{ role: "user", content: job.prompt }],
      principal,
      via: "job",
      confirmWrites: false,
      maxRounds: 6,
      onAssistant: async (message) => {
        const totals = usageTotals(message);
        usage.tokensIn += totals.tokensIn;
        usage.tokensOut += totals.tokensOut;
      },
    });
    text = outcome.last ? messageText(outcome.last) : "";
    if (outcome.stop !== "done" || !text) throw new Error(outcome.stop);
  } catch {
    console.error("[assistant] scheduled job failed");
    await recordAssistantUsage({ workspaceId: workspace.id, userId: job.createdById, label: `Scheduled: ${job.name}`, ...usage }).catch(() => undefined);
    await dispatch(workspace.id, {
      type: "assistant.job.completed",
      title: `Scheduled job failed: ${job.name}`.slice(0, 150),
      url: `/w/${workspace.slug}/assistant/jobs`,
      recipients: [job.createdById],
      resource: { type: "scheduled_job", id: job.id },
      data: { jobId: job.id, conversationId: null, status: "failed" },
    }).catch(() => undefined);
    return finish({ status: "failed", detail: "The assistant couldn't finish this run." });
  }

  // Keep the result in the creator's job conversation.
  const title = conversationTitleFor(job.name);
  const conversation =
    (await prisma.assistantConversation.findFirst({ where: { workspaceId: workspace.id, userId: job.createdById, title }, select: { id: true } })) ??
    (await prisma.assistantConversation.create({ data: { workspaceId: workspace.id, userId: job.createdById, title }, select: { id: true } }));
  await prisma.assistantMessage.createMany({
    data: [
      { conversationId: conversation.id, role: "USER", content: [{ type: "text", text: job.prompt }] as Prisma.InputJsonValue, createdAt: now },
      { conversationId: conversation.id, role: "ASSISTANT", content: [{ type: "text", text }] as Prisma.InputJsonValue, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, createdAt: new Date(now.getTime() + 1) },
    ],
  });
  await prisma.assistantConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

  let postUrl = `/w/${workspace.slug}/assistant/c/${conversation.id}`;
  if (job.channelId) {
    const channel = await prisma.channel.findFirst({ where: { id: job.channelId, workspaceId: workspace.id, archivedAt: null, kind: { not: "DIRECT" } }, select: { id: true, slug: true, kind: true } });
    if (channel) {
      const body = text.length > MAX_POST_CHARS ? `${text.slice(0, MAX_POST_CHARS - 1)}…` : text;
      const message = await prisma.$transaction(async (tx) => {
        const row = await tx.message.create({ data: { workspaceId: workspace.id, channelId: channel.id, authorKind: "ASSISTANT", body }, select: { id: true } });
        await tx.channel.update({ where: { id: channel.id }, data: { lastMessageAt: new Date() } });
        return row;
      });
      const audience = channel.kind === "PUBLIC" ? null : (await prisma.channelMember.findMany({ where: { channelId: channel.id }, select: { userId: true } })).map((m) => m.userId);
      await publish(workspace.id, `channel:${channel.id}`, { type: "message.created", data: { channelId: channel.id, messageId: message.id }, ...(audience ? { audience } : {}) });
      postUrl = `/w/${workspace.slug}/chat/${channel.slug}`;
    }
  }

  await dispatch(workspace.id, {
    type: "digest.ready",
    title: `${job.name} is ready`.slice(0, 150),
    body: text.slice(0, 1500),
    url: postUrl,
    resource: { type: "scheduled_job", id: job.id },
    scope: { digestId: job.id },
    data: { frequency: digestFrequency(job.cron), jobId: job.id },
  });
  await dispatch(workspace.id, {
    type: "assistant.job.completed",
    title: `Scheduled job finished: ${job.name}`.slice(0, 150),
    url: postUrl,
    recipients: [job.createdById],
    resource: { type: "scheduled_job", id: job.id },
    data: { jobId: job.id, conversationId: conversation.id, status: "ok" },
  });
  return finish({ status: "ok", text });
}

/** Periodic tick: schedule new jobs, then claim and run the due ones (idempotent across replicas). */
export async function runDueJobs(now: Date): Promise<number> {
  const unscheduled = await prisma.scheduledJob.findMany({ where: { enabled: true, nextRunAt: null }, select: { id: true, cron: true, timezone: true }, take: 50 });
  for (const job of unscheduled) {
    try {
      await prisma.scheduledJob.updateMany({ where: { id: job.id, nextRunAt: null }, data: { nextRunAt: nextRunAt(job.cron, job.timezone, now) } });
    } catch {
      await prisma.scheduledJob.update({ where: { id: job.id }, data: { enabled: false, lastStatus: "skipped: invalid schedule" } });
    }
  }

  const due = await prisma.scheduledJob.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: MAX_JOBS_PER_TICK,
    select: { id: true, cron: true, timezone: true, nextRunAt: true },
  });
  let ran = 0;
  for (const job of due) {
    let next: Date;
    try {
      next = nextRunAt(job.cron, job.timezone, now);
    } catch {
      await prisma.scheduledJob.update({ where: { id: job.id }, data: { enabled: false, lastStatus: "skipped: invalid schedule" } });
      continue;
    }
    const claim = await prisma.scheduledJob.updateMany({ where: { id: job.id, enabled: true, nextRunAt: job.nextRunAt }, data: { nextRunAt: next } });
    if (claim.count === 0) continue;
    await runScheduledJob(job.id, now);
    ran++;
  }
  return ran;
}
