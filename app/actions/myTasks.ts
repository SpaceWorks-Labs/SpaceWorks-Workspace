"use server";

import { z } from "zod";
import { getWorkspaceForAction } from "@/lib/permissions";
import { parseMyTasksTab, type MyTaskItem } from "@/lib/tasks/myTasks";
import { listMyTasks } from "@/lib/tasks/queries";

/** Loader for My Tasks tabs (switching tabs and realtime refetch). Reads only; mutations reuse app/actions/tasks.ts. */
export async function loadMyTasksTabAction(slug: string, tab: string): Promise<MyTaskItem[] | null> {
  const parsed = z.string().min(1).max(64).safeParse(slug);
  const ctx = parsed.success ? await getWorkspaceForAction(parsed.data, "GUEST") : null;
  if (!ctx) return null;
  return listMyTasks(ctx, new Date(), parseMyTasksTab(tab));
}
