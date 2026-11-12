import "server-only";

/** Read models for the board, list, task detail and My tasks. Always tenant- and visibility-filtered. */

export { permissionsFor, projectSummary, workspaceLabels, findProjectByKey, listTransferTargets } from "./queries/projects";
export { getBoardData, listArchivedTasks, type ArchivedTaskDTO } from "./queries/board";
export { findVisibleTaskByNumber, getTaskDetail } from "./queries/detail";
export { listMyTasks } from "./queries/my-tasks";
export { directReportIds } from "./queries/my-tasks";
export { listQuickAddProjects } from "./queries/my-tasks-quick-add";
