// Generated from app/w/[workspaceSlug]/finance/statements/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { canViewFinance, requireWorkspace } from "@/lib/permissions";
import { loadStatements } from "@/lib/finance/statements/load";

export async function loadPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/finance/statements">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewFinance(actor.membership, actor.workspace)) notFound();
const raw = await searchParams;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const data = await loadStatements(actor, { year: Number(one(raw.year)) || undefined, currency: one(raw.currency) });
const base = `/w/${workspaceSlug}/finance/statements`;
return viewDto({ actor, data, base } as const);
}
