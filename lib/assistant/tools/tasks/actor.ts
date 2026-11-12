import "server-only";

import type { ActionResult } from "@/lib/actionResult";
import { NOT_ALLOWED } from "@/lib/actionResult";
import { prisma } from "@/lib/db";
import { effectiveJobRole, type Principal, type ToolChannel } from "@/lib/assistant/principal";
import { ToolError, type ToolContext } from "@/lib/assistant/tools/types";
import { assignableMembers, type TaskActor } from "@/lib/tasks/access";
import { ALREADY_CLAIMED_MESSAGE, RESTRICTED_EDIT_MESSAGE, type TaskSource } from "@/lib/tasks/capabilities";
import { toDateInputValue } from "@/lib/tasks/localDate";
import { ARCHIVED_PROJECT, ARCHIVED_TASK, CHANGED_MESSAGE, NOT_FOUND } from "@/lib/tasks/service/helpers";
import { SAME_PROJECT_MESSAGE, SUBTASK_MESSAGE, TEMPLATE_MESSAGE } from "@/lib/tasks/service/transfer";

const SOURCE_BY_CHANNEL: Record<ToolChannel, TaskSource> = { chat: "assistant", job: "assistant", mcp: "mcp", api: "api" };

/** Synchronous actor for read filters (no database check). Writes use `principalToActor`. */
export function actorFromPrincipal(principal: Principal, via: ToolChannel = "chat"): TaskActor {
  return {
    user: { id: principal.userId, name: principal.userName },
    workspace: { id: principal.workspace.id, slug: principal.workspace.slug, name: principal.workspace.name, timezone: principal.workspace.timezone },
    membership: { role: principal.kind === "job" ? effectiveJobRole(principal.role) : principal.role },
    via: { source: SOURCE_BY_CHANNEL[via], ...(principal.tokenName ? { client: principal.tokenName.slice(0, 80) } : {}) },
  };
}

/**
 * The service actor for a tool call: the tool `Principal` re-checked against
 * the live user and membership (disabled users and removed members are refused)
 * and stamped with where the call came from (`via.source`: assistant, mcp, api).
 * Scope, role and confirmation checks stay in the tool layer.
 */
export async function principalToActor(ctx: ToolContext): Promise<TaskActor> {
  const { principal } = ctx;
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: principal.userId, workspaceId: principal.workspace.id } },
    select: { role: true, status: true, user: { select: { name: true, disabledAt: true } } },
  });
  if (!membership || membership.status !== "ACTIVE" || membership.user.disabledAt) throw new ToolError(NOT_ALLOWED, "forbidden");
  const actor = actorFromPrincipal({ ...principal, userName: membership.user.name }, ctx.via);
  return { ...actor, membership: { role: principal.kind === "job" ? effectiveJobRole(membership.role) : membership.role } };
}

/** Service `ActionResult` failures as `ToolError`s (REST maps the codes to 400/403/404/409). */
export function unwrap<T>(result: ActionResult<T>): T | undefined {
  if (result.ok) return result.data;
  const message = result.error;
  if (message === NOT_FOUND || /doesn't exist/.test(message)) throw new ToolError(message, "not_found");
  if (message === NOT_ALLOWED || message === RESTRICTED_EDIT_MESSAGE) throw new ToolError(message, "forbidden");
  if (message === ARCHIVED_PROJECT || message === ARCHIVED_TASK || message === ALREADY_CLAIMED_MESSAGE || message === SUBTASK_MESSAGE || message === TEMPLATE_MESSAGE || message === SAME_PROJECT_MESSAGE || message === CHANGED_MESSAGE) throw new ToolError(message, "conflict");
  throw new ToolError(message, "invalid");
}

/** Date-only ("2026-11-02") stays a workspace-local calendar day; a date-time becomes the workspace-local day it falls on. */
export function toDueDate(value: string | null | undefined, timeZone: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return toDateInputValue(new Date(value), timeZone);
}

/** "me" → the caller; duplicates removed. */
export function resolveUserIds(ids: readonly string[], me: string): string[] {
  return [...new Set(ids.map((id) => (id === "me" ? me : id)))];
}

/**
 * Fail before any write when a person about to be ADDED to a task cannot be
 * assigned (unknown, disabled, guest or not on the project's private team).
 * Already-assigned people are exempt, matching the service.
 */
export async function assertAssignable(actor: TaskActor, project: { teamId: string | null } | null, ids: readonly string[], alreadyAssigned: readonly string[] = []) {
  const added = ids.filter((id) => !alreadyAssigned.includes(id));
  if (added.length === 0) return;
  const allowed = new Set((await assignableMembers(actor.workspace.id, project)).map((person) => person.id));
  const bad = added.filter((id) => !allowed.has(id));
  if (bad.length) throw new ToolError(`Can't assign ${bad.join(", ")}: only active members who can see this project can be assigned. Nothing was changed.`, "invalid");
}
