import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findDownloadableFile } from "@/lib/files";
import { moduleForFolder } from "@/lib/fileModules";
import { workspaceHasModule } from "@/lib/modules-server";
import { withMetrics } from "@/lib/observability/metrics/http";
import { fileResponse } from "@/lib/storage";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** Authorised download of a private workspace file. `?download=1` forces an attachment. */
async function getFile(request: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return notFound();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) return notFound();
  const file = await findDownloadableFile(id, userId);
  if (!file) return notFound();
  // Files of a module the super admin switched off stay stored but are not served.
  const owners = [moduleForFolder(file.folder), ...(file._count.ledgerReceipts > 0 ? (["finance"] as const) : [])];
  for (const key of owners) if (!(await workspaceHasModule(file.workspaceId, key))) return notFound();
  const download = new URL(request.url).searchParams.get("download") === "1";
  return fileResponse(file, { download });
}

export const GET = withMetrics(getFile);
