import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { checkRateLimitById } from "@/lib/rateLimit";
import { indexSearchDocument } from "@/lib/search/documents";
import { taskUrl } from "@/lib/tasks/links";
import { nextWorkspaceSequence } from "@/lib/counters";
import { dispatch } from "@/lib/notify/dispatch";
import type { OpsActor } from "@/lib/approvals/context";
import { guard, parse, title, optionalDate, optionalId, id, note, OpsError } from "@/lib/approvals/ops";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { fieldsSchema, answerSchema, csvCell } from "./schema";

export async function saveForm(actor: OpsActor, input: unknown) {
 await guard(actor, true);
 const v = parse(z.object({ id: optionalId, title, description: z.string().trim().max(2000).optional(), fields: fieldsSchema, visibility: z.enum(["INTERNAL", "PUBLIC_LINK"]), closesAt: optionalDate, maxResponses: z.preprocess(v => v === "" ? null : v, z.coerce.number().int().min(1).max(100000).nullable().optional()) }), input);
 return prisma.$transaction(async tx => {
  if (v.id) await tx.$queryRaw`SELECT "id" FROM "Form" WHERE "id"=${v.id} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
  const old = v.id ? await tx.form.findFirst({ where: { id: v.id, workspaceId: actor.workspace.id }, include: { _count: { select: { submissions: true } } } }) : null;
  if (v.id && !old) throw new OpsError("That form is unavailable.");
  if (old?._count.submissions && JSON.stringify(parse(fieldsSchema, old.fields)) !== JSON.stringify(v.fields)) throw new OpsError("This form already has responses. Create a new form to change its questions.");
  const token = v.visibility === "PUBLIC_LINK" && !old?.publicSlug ? randomToken(32) : null;
  const { id: formId, ...data } = v;
  const publicSlug = v.visibility === "INTERNAL" ? null : token ? sha256Hex(token) : old?.publicSlug;
  const row = formId ? await tx.form.update({ where: { id: formId, workspaceId: actor.workspace.id }, data: { ...data, fields: v.fields as Prisma.InputJsonValue, publicSlug } }) : await tx.form.create({ data: { ...data, fields: v.fields as Prisma.InputJsonValue, publicSlug, workspaceId: actor.workspace.id, ownerIds: [actor.user.id], createdById: actor.user.id } });
  await note(actor, "form", row.id, formId ? "updated" : "created", tx);
  return { id: row.id, publicPath: token ? `/f/${token}` : null };
 });
}
export async function listForms(actor: OpsActor) {
 await guard(actor);
 return prisma.form.findMany({ where: { workspaceId: actor.workspace.id, ...teamScopeFilter(await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role })) }, select: { id: true, title: true, description: true, fields: true, visibility: true, closesAt: true, maxResponses: true, _count: { select: { submissions: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
}
export async function publicForm(token: string) {
 if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
 return prisma.form.findFirst({ where: { publicSlug: sha256Hex(token), visibility: "PUBLIC_LINK", workspace: { status: "ACTIVE", archivedAt: null } }, select: { id: true, workspaceId: true, title: true, description: true, fields: true, closesAt: true, maxResponses: true } });
}
export async function submitForm(input: { token?: string; formId?: string; actor?: OpsActor; answers: unknown; honeypot?: string; ip: string }, now = new Date()) {
 // Honeypot responses appear successful without storing untrusted payloads.
 if (input.honeypot) return;
 const ipHash = sha256Hex(input.ip);
 const key = sha256Hex(`${input.token ?? input.formId}:${ipHash}`);
 if (!await checkRateLimitById("apiWrite", `form:${key}`)) throw new OpsError("Too many responses. Wait before trying again.");
 if (input.actor) await guard(input.actor);
 const form = input.token ? await publicForm(input.token) : input.actor && input.formId ? await prisma.form.findFirst({ where: { id: input.formId, workspaceId: input.actor.workspace.id, ...teamScopeFilter(await hiddenTeamIds(input.actor.workspace.id, { userId: input.actor.user.id, role: input.actor.membership.role })) } }) : null;
 if (!form) throw new OpsError("This form is unavailable.");
 const fields = parse(fieldsSchema, form.fields);
 const answers = parse(answerSchema(fields), input.answers) as Prisma.InputJsonValue;
 const after = await prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT "id" FROM "Form" WHERE "id"=${form.id} AND "workspaceId"=${form.workspaceId} FOR UPDATE`;
  const current = await tx.form.findFirst({ where: { id: form.id, workspaceId: form.workspaceId, workspace: { status: "ACTIVE", archivedAt: null }, ...(input.token ? { publicSlug: sha256Hex(input.token), visibility: "PUBLIC_LINK" } : {}) }, include: { workspace: { select: { slug: true } } } });
  if (!current || (current.closesAt && current.closesAt <= now)) throw new OpsError("This form is closed.");
  if (current.maxResponses && await tx.formSubmission.count({ where: { formId: current.id, form: { workspaceId: current.workspaceId } } }) >= current.maxResponses) throw new OpsError("This form has reached its response limit.");
  // Persisted per-form limit holds across replicas even without a Redis fallback.
  if (input.token && await tx.formSubmission.count({ where: { formId: current.id, ipHash, createdAt: { gte: new Date(now.getTime() - 3600000) }, form: { workspaceId: current.workspaceId } } }) >= 5) throw new OpsError("Too many responses. Try again in an hour.");
  const row = await tx.formSubmission.create({ data: { formId: current.id, answers, submitterUserId: input.actor?.user.id, ipHash, createdAt: now } });
  const recipients = (await tx.membership.findMany({ where: { workspaceId: current.workspaceId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } })).map(m => m.userId);
  return (await dispatch(current.workspaceId, { type: "form.submitted", title: "A new form response is ready", recipients, actorId: input.actor?.user.id, url: `/w/${current.workspace.slug}/forms/${current.id}`, scope: { formId: current.id }, data: { formId: current.id, submissionId: row.id } }, { tx })).afterCommit;
 }); await after();
}
export async function submissions(actor: OpsActor, formId: string) {
 await guard(actor, true); parse(id, formId);
 const form = await prisma.form.findFirst({ where: { id: formId, workspaceId: actor.workspace.id }, select: { id: true, title: true, fields: true } });
 if (!form) throw new OpsError("This form is unavailable.");
 return { form, rows: await prisma.formSubmission.findMany({ where: { formId, form: { workspaceId: actor.workspace.id } }, orderBy: { createdAt: "desc" }, take: 1000 }) };
}
export async function closeForm(actor: OpsActor, formId: string) {
 await guard(actor, true); parse(id, formId);
 await prisma.form.updateMany({ where: { id: formId, workspaceId: actor.workspace.id }, data: { closesAt: new Date(), publicSlug: null } }); await note(actor, "form", formId, "closed");
}
export async function rotatePublicLink(actor: OpsActor, formId: string) {
 await guard(actor, true); parse(id, formId); const token = randomToken(32);
 const result = await prisma.form.updateMany({ where: { id: formId, workspaceId: actor.workspace.id, visibility: "PUBLIC_LINK" }, data: { publicSlug: sha256Hex(token) } });
 if (!result.count) throw new OpsError("Choose a public form."); await note(actor, "form", formId, "link_rotated"); return `/f/${token}`;
}
export async function convertToTask(actor: OpsActor, submissionId: string, taskTitle: string) {
 await guard(actor, true); parse(id, submissionId); const name = parse(title, taskTitle);
 return prisma.$transaction(async tx => {
  const rows = await tx.$queryRaw<{id:string}[]>`SELECT s."id" FROM "FormSubmission" s JOIN "Form" f ON f."id"=s."formId" WHERE s."id"=${submissionId} AND f."workspaceId"=${actor.workspace.id} FOR UPDATE OF s`;
  if (!rows.length) throw new OpsError("That response is unavailable.");
  const row = await tx.formSubmission.findFirstOrThrow({ where: { id: submissionId, form: { workspaceId: actor.workspace.id } } });
  if (row.linkedType === "task" && row.linkedId) return row.linkedId;
  // Explicit intake conversion: no response content is copied into a less restricted task.
  const task = await tx.task.create({ data: { workspaceId: actor.workspace.id, title: name, number: await nextWorkspaceSequence(tx, actor.workspace.id, "task"), creatorId: actor.user.id, assignees: { create: { userId: actor.user.id } } } });
  await indexSearchDocument({ workspaceId: actor.workspace.id, entityType: "task", entityId: task.id, title: name, url: taskUrl(actor.workspace.slug, null, task.number), ownerId: actor.user.id }, tx);
  await tx.recordLink.create({ data: { workspaceId: actor.workspace.id, fromType: "form_submission", fromId: row.id, toType: "task", toId: task.id, createdById: actor.user.id } });
  await tx.formSubmission.update({ where: { id: row.id }, data: { linkedType: "task", linkedId: task.id, status: "ACCEPTED" } });
  await note(actor, "form", row.formId, "converted_to_task", tx); return task.id;
 });
}
export async function exportCsv(actor: OpsActor, formId: string) {
 await guard(actor, true); parse(id, formId);
 const form = await prisma.form.findFirst({ where: { id: formId, workspaceId: actor.workspace.id }, select: { fields: true } });
 if (!form) throw new OpsError("This form is unavailable.");
 const fields = parse(fieldsSchema, form.fields);
 const snapshot = new Date();
 const encoder = new TextEncoder();
 let cursor: string | undefined;
 let cancelled = false;
 await note(actor, "form", formId, "exported");
 return new ReadableStream<Uint8Array>({
  start(controller) { controller.enqueue(encoder.encode("\uFEFF" + ["Response", "Received (UTC)", ...fields.map(f => f.label)].map(csvCell).join(",") + "\r\n")); },
  async pull(controller) {
   if (cancelled) return;
   try {
    // Bounded batches export the entire snapshot without retaining every answer.
    await guard(actor, true);
    const rows = await prisma.formSubmission.findMany({ where: { formId, form: { workspaceId: actor.workspace.id }, createdAt: { lte: snapshot } }, orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, createdAt: true, answers: true } });
    if (cancelled) return;
    if (rows.length) {
     const lines = rows.map(row => { const answers = row.answers as Record<string, unknown>; return [row.id, row.createdAt.toISOString(), ...fields.map(f => answers[f.key])].map(csvCell).join(","); });
     controller.enqueue(encoder.encode(lines.join("\r\n") + "\r\n"));
     cursor = rows[rows.length-1].id;
    }
    if (rows.length < 100) controller.close();
   } catch { controller.error(new OpsError("Couldn't export responses. Try again.")); }
  },
  cancel() { cancelled = true; },
 });
}
