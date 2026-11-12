import "server-only";

import { listTasks, getTask, listProjects } from "./tasks/queries";
import { createTask, updateTask } from "./tasks/mutations";
import { addTaskComment, archiveTask, moveTaskTool } from "./tasks/actions";
import { assignTaskTool, claimTaskTool } from "./tasks/assignment";

export { parseTaskNumber } from "./tasks/records";
export { listTasks, getTask, listProjects, createTask, updateTask };

export const TASK_TOOLS = [listTasks, getTask, listProjects, createTask, updateTask, addTaskComment, archiveTask, moveTaskTool, assignTaskTool, claimTaskTool];
