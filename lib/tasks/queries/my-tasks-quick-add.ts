import "server-only";
import { prisma } from "@/lib/db";
import { canEditTasks, visibleProjectWhere, type TaskActor } from "@/lib/tasks/access";
import type { QuickAddProject } from "@/lib/tasks/myTasks";

/** Active projects the actor can add a task to (none for guests). */
export async function listQuickAddProjects(actor: TaskActor): Promise<QuickAddProject[]> {
  if (!canEditTasks(actor)) return [];
  return prisma.project.findMany({
    where: { AND: [await visibleProjectWhere(actor), { status: "ACTIVE" }] },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, key: true, name: true },
  });
}
