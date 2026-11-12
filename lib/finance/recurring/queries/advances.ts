import "server-only";
import { prisma } from "@/lib/db";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { canManageFinance, canReadStaffAdvance } from "@/lib/roles";
import {
  FinanceError,
  auditPayView,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { financePickers } from "@/lib/finance/tools/queries";
import type { RecurringQuery } from "./types";
import { files } from "./files";

export async function advancesView(
  actor: FinanceActor,
  q: RecurringQuery = {},
  exporting = false,
) {
  const member = await activeMemberOrSuperAdmin(prisma, actor);
  const grant = await prisma.financePayrollGrant.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: actor.workspace.id,
        userId: actor.user.id,
      },
    },
  });
  if (
    !member ||
    !canReadStaffAdvance(member, grant, actor.user.id, actor.user.id)
  )
    throw new FinanceError("You don't have access to advances.");
  const manage = !!grant?.manage;
  const page = Math.max(1, Math.min(250, Math.trunc(Number(q.page) || 1)));
  const where = {
    workspaceId: actor.workspace.id,
    ...(grant?.manage ? {} : { userId: actor.user.id }),
    ...(q.status ? { status: q.status } : {}),
    ...(q.q
      ? {
          reason: { contains: q.q.slice(0, 120), mode: "insensitive" as const },
        }
      : {}),
    ...(q.person ? { profileId: q.person } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.staffAdvance.findMany({
      where,
      include: { recoveries: { orderBy: { dueOn: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: exporting ? 10001 : 40,
      ...(exporting ? {} : { skip: (page - 1) * 40 }),
    }),
    prisma.staffAdvance.count({ where }),
  ]);
  if (exporting && rows.length > 10000)
    throw new FinanceError("Narrow the export to at most 10,000 advances.");
  await auditPayView(actor, "staff_advances", actor.workspace.id);
  const profiles = manage
    ? await prisma.financePayProfile.findMany({
        where: {
          workspaceId: actor.workspace.id,
          archivedAt: null,
          userId: { not: null },
        },
        select: { id: true, name: true, currency: true },
      })
    : [];
  const grants = manage
    ? await prisma.financePayrollGrant.findMany({
        where: { workspaceId: actor.workspace.id, manage: true },
        select: { userId: true },
      })
    : [];
  const people = manage
    ? await prisma.membership.findMany({
        where: {
          workspaceId: actor.workspace.id,
          userId: { in: grants.map((g) => g.userId) },
          status: "ACTIVE",
          role: { not: "GUEST" },
          user: { disabledAt: null },
        },
        select: { userId: true, user: { select: { name: true } } },
      })
    : [];
  const runs = manage
    ? await prisma.financePayRun.findMany({
        where: { workspaceId: actor.workspace.id, status: "PAID" },
        select: { id: true, month: true, profileId: true, paidOn: true },
        orderBy: { month: "desc" },
        take: 1000,
      })
    : [];
  return {
    rows,
    manage,
    total,
    page,
    payrollView: !!grant,
    financeManage: canManageFinance(member),
    profiles,
    people: people.map((p) => ({
      id: p.userId,
      name: p.user.name ?? "Payroll manager",
    })),
    runs,
    pickers: manage ? await financePickers(actor, true) : null,
    files: await files(
      actor,
      "ADVANCE",
      rows.map((r) => r.id),
    ),
  };
}
export type AdvancesView = Awaited<ReturnType<typeof advancesView>>;
