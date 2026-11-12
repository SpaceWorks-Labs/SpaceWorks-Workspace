// Generated from app/w/[workspaceSlug]/stock/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { canManageAssets } from "@/lib/roles";
import { listStock, recentMovements } from "@/lib/makerspace/stock";
const SHOWN = 200;
export async function loadStockPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/stock">) {
const { workspaceSlug } = await params;
const sp = await searchParams;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const low = sp.low === "1";
const archived = sp.archived === "1";
const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
const canManage = canManageAssets(ctx.membership);
const [items, all] = await Promise.all([listStock(ctx, { low, q, archived }), listStock(ctx)]);
const shown = items.slice(0, SHOWN);
const movements = await recentMovements(ctx, shown.map((item) => item.id));
const lowCount = all.filter((item) => item.low).length;
const base = `/w/${workspaceSlug}/stock`;
const query = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...extra })}`;
return viewDto({ ctx, low, archived, q, canManage, items, all, shown, movements, lowCount, base } as const);
}
