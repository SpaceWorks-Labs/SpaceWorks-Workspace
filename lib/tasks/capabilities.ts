import type { WorkspaceRole } from "@prisma/client";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";

/**
 * Pure per-task permission rules (client-safe, shared by the services in
 * lib/tasks/service and the DTO builders in lib/tasks/queries so the UI
 * never offers an action the server would reject).
 *
 * | action     | restrictTaskEdits off | restrictTaskEdits on                              |
 * | edit       | MEMBER+               | creator, assignee, project owner, ADMIN/OWNER     |
 * | claim      | MEMBER+               | MEMBER+ and the task has no assignees yet         |
 * | unclaim    | current assignee      | current assignee                                  |
 * | contribute | MEMBER+               | MEMBER+                                           |
 */

export type TaskAction = "edit" | "claim" | "unclaim" | "contribute";
export type TaskSource = "web" | "assistant" | "mcp" | "api";

export type TaskCapabilityInput = {
  role: WorkspaceRole;
  userId: string;
  restrictTaskEdits: boolean;
  projectOwnerId: string | null;
  creatorId: string | null;
  assigneeIds: readonly string[];
};

export type TaskCapabilities = {
  canEdit: boolean;
  canClaim: boolean;
  canUnclaim: boolean;
  isAssignedToMe: boolean;
};

export const RESTRICTED_EDIT_MESSAGE = "Only the creator, assignees and project admins can edit this task.";
export const ALREADY_CLAIMED_MESSAGE = "This task already has an assignee. Ask a project admin to add you.";

export function canPerformTaskAction(action: TaskAction, input: TaskCapabilityInput): boolean {
  const member = canContribute({ role: input.role });
  if (!member) return false;
  const assigned = input.assigneeIds.includes(input.userId);
  switch (action) {
    case "contribute":
      return true;
    case "unclaim":
      return assigned;
    case "claim":
      return !input.restrictTaskEdits || input.assigneeIds.length === 0;
    case "edit":
      return (
        !input.restrictTaskEdits ||
        input.creatorId === input.userId ||
        assigned ||
        input.projectOwnerId === input.userId ||
        hasRoleAtLeast(input.role, "ADMIN")
      );
  }
}

/** What the viewer may do on one task (for DTOs). Archive state is applied by the caller. */
export function taskCapabilities(input: TaskCapabilityInput): TaskCapabilities {
  const isAssignedToMe = input.assigneeIds.includes(input.userId);
  const canEdit = canPerformTaskAction("edit", input);
  return {
    canEdit,
    canClaim: !isAssignedToMe && (canPerformTaskAction("claim", input) || canEdit),
    canUnclaim: isAssignedToMe && canPerformTaskAction("unclaim", input),
    isAssignedToMe,
  };
}
