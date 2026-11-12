import type { TaskTypeRef } from "@/lib/tasks/taskTypes";
import type { ColumnCategory, LabelTone, ProjectStatus, TaskPriority } from "@prisma/client";

/** Serializable shapes passed from server code to the board, list and task detail (client-safe). */

export type PersonRef = { id: string; name: string | null; image: string | null };
export type LabelRef = { id: string; name: string; tone: LabelTone };

export type ColumnDTO = { id: string; name: string; position: number; category: ColumnCategory };

export type BoardTask = {
  id: string;
  number: number;
  title: string;
  priority: TaskPriority;
  /** ISO start of the local due day. */
  dueAt: string | null;
  completedAt: string | null;
  columnId: string | null;
  /** Effective type id (the project's default when the task has none). FilterBar can filter on it. */
  typeId: string | null;
  position: number;
  assigneeIds: string[];
  labelIds: string[];
  /** Per-task rights for the viewer (lib/tasks/capabilities). */
  canEdit: boolean;
  canClaim: boolean;
  canUnclaim: boolean;
  isAssignedToMe: boolean;
  subtaskCount: number;
  subtaskDone: number;
  commentCount: number;
  attachmentCount: number;
  blocked: boolean;
  recurring: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  cyclesEnabled: boolean;
  /** Only the creator, assignees, project owner and admins edit a task. */
  restrictTaskEdits: boolean;
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  ownerId: string | null;
  teamId: string | null;
  teamName: string | null;
  startsOn: string | null;
  dueOn: string | null;
};

export type ProjectPermissions = {
  /** Create, edit, move, assign tasks (MEMBER and up). */
  canEdit: boolean;
  /** Comment (everyone who can see the project). */
  canComment: boolean;
  /** Edit the project, its columns and archive it (ADMIN or the project owner). */
  canManage: boolean;
};

export type BoardData = {
  project: ProjectSummary;
  columns: ColumnDTO[];
  tasks: BoardTask[];
  /** Assignable people (members and up). */
  members: PersonRef[];
  labels: LabelRef[];
  taskTypes: TaskTypeRef[];
  permissions: ProjectPermissions;
};

export type TaskRef = { id: string; number: number; title: string; projectKey: string | null; completedAt: string | null; archivedAt: string | null };

export type CommentDTO = {
  id: string;
  author: PersonRef | null;
  /** Plain text with mention tokens `<@userId>`. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  canEdit: boolean;
};

export type ActivityDTO = { id: string; actor: PersonRef | null; kind: string; text: string; createdAt: string };

export type AttachmentDTO = { id: string; filename: string; size: number; contentType: string; url: string; uploadedBy: PersonRef | null; createdAt: string; canDelete: boolean };

export type RecurrenceDTO = {
  id: string;
  rrule: string;
  description: string;
  createMode: "ON_SCHEDULE" | "ON_COMPLETION";
  assigneeMode: "FIXED" | "ROTATE";
  assigneeIds: string[];
  dueOffsetDays: number | null;
  nextRunAt: string | null;
  active: boolean;
  /** True when this task is the rule's template (the repeat control edits it here). */
  isTemplate: boolean;
};

export type TaskDetailDTO = {
  startsOn: string | null;
  blockerReason: string | null;
  blockerOwnerId: string | null;
  id: string;
  number: number;
  title: string;
  /** Sanitised HTML. */
  description: string | null;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  creator: PersonRef | null;
  columnId: string | null;
  /** Effective type id (default when unset); null for tasks without a project. */
  typeId: string | null;
  taskTypes: TaskTypeRef[];
  project: ProjectSummary | null;
  columns: ColumnDTO[];
  parent: TaskRef | null;
  assignees: PersonRef[];
  labelIds: string[];
  subtasks: Array<TaskRef & { assignees: PersonRef[] }>;
  blockedBy: TaskRef[];
  blocks: TaskRef[];
  comments: CommentDTO[];
  activity: ActivityDTO[];
  attachments: AttachmentDTO[];
  recurrence: RecurrenceDTO | null;
  members: PersonRef[];
  labels: LabelRef[];
  /** `canEdit` is per task here (restricted projects), not per project. */
  permissions: ProjectPermissions;
  canClaim: boolean;
  canUnclaim: boolean;
  isAssignedToMe: boolean;
  /** Canonical app-relative link. */
  url: string;
  reference: string;
  timeZone: string;
  viewerId: string;
};

export type MyTaskDTO = {
  id: string;
  number: number;
  title: string;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  projectKey: string | null;
  projectName: string | null;
  labelIds: string[];
  blocked: boolean;
  canEdit: boolean;
  canClaim: boolean;
  isAssignedToMe: boolean;
  url: string;
};
