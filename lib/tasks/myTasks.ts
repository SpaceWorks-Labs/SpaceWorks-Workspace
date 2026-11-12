import type { MyTaskDTO, PersonRef } from "@/lib/tasks/types";

/** My Tasks tabs and row shape (pure, client-safe). */

export const MY_TASK_TABS = [
  { value: "assigned", label: "Assigned to me", description: "Everything assigned to you, across projects, by when it's due." },
  { value: "assigned-by-me", label: "Assigned by me", description: "Tasks you handed to other people." },
  { value: "team", label: "My team", description: "Open tasks assigned to your direct reports." },
  { value: "created", label: "Created by me", description: "Tasks you created." },
] as const;

export type MyTasksTab = (typeof MY_TASK_TABS)[number]["value"];

export function parseMyTasksTab(value: string | string[] | null | undefined): MyTasksTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return MY_TASK_TABS.find((tab) => tab.value === raw)?.value ?? "assigned";
}

/** One My Tasks row: the task plus everyone it is assigned to. */
export type MyTaskItem = MyTaskDTO & { assignees: PersonRef[] };

/** Active projects a quick-added task can go into. */
export type QuickAddProject = { id: string; key: string; name: string };

/** Tabs the viewer can see: "My team" only with direct reports. */
export function visibleMyTaskTabs(hasTeam: boolean) {
  return MY_TASK_TABS.filter((tab) => tab.value !== "team" || hasTeam);
}
