import { auth } from "@/lib/auth";
import { findWorkspaceForUser } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { canManageAssets, canUseAssets } from "@/lib/roles";
import { stockCsv } from "@/lib/makerspace/stock";

export async function GET(request: Request, { params }: RouteContext<"/w/[workspaceSlug]/stock/export">) {
  const { workspaceSlug } = await params;
  const session = await auth();
  if (!session?.user?.id) return new Response("Not found", { status: 404 });
  const context = await findWorkspaceForUser(workspaceSlug, session.user.id);
  if (!context || !canUseAssets(context.membership)) return new Response("Not found", { status: 404 });
  if (await isActionRateLimited("action", session.user.id)) return new Response("Try again shortly.", { status: 429 });
  const low = new URL(request.url).searchParams.get("low") === "1";
  const actor = { ...context, user: { id: session.user.id, name: session.user.name ?? null } };
  const body = await stockCsv(actor, { low }, canManageAssets(context.membership));
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="stock-${workspaceSlug}.csv"`, "cache-control": "private, no-store" } });
}
