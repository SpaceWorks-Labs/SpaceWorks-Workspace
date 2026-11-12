import "server-only";

/**
 * Task mutations. Each function takes an actor resolved server-side
 * (Server Actions use `getWorkspaceForAction`), re-checks capability and
 * visibility, validates with Zod, writes in a transaction together with
 * the task history (TaskActivity), the workspace activity feed, audit rows
 * and notifications (`dispatch` with `{ tx }`), then reindexes search and
 * publishes realtime nudges after commit.
 */

export { loadVisibleTask } from "./service/helpers";
export { createTask, updateTask } from "./service/create-update";
export { moveTask, setTaskCompleted } from "./service/status";
export { setLabels, setTaskArchived } from "./service/labels-archive";
export { assignTask, claimTask, setAssignees, unassignTask, unclaimTask } from "./service/assignments";
export { addComment, editComment, deleteComment } from "./service/comments";
export { addDependency, removeDependency } from "./service/dependencies";
export { addAttachment, removeAttachment } from "./service/attachments";
export { deleteTaskPermanently } from "./service/permanentDelete";
export { uploadDescriptionImage } from "./service/inlineImage";
export { bulkUpdateTasks } from "./service/bulk";
export { transferTask, previewTransfer } from "./service/transfer";
export { createTaskType, deleteTaskType, listTaskTypes, listTaskTypesFor, reorderTaskTypes, setDefaultTaskType, updateTaskType } from "./service/types";
