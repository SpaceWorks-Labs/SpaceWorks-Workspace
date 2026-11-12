// Generated from app/w/[workspaceSlug]/assets/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canUseAssets } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { listAssets } from "@/lib/assets/service";
import { isAdmin } from "@/lib/approvals/context";
import { opsPickers } from "@/lib/approvals/pickers";
import { downtimeCostReport, downtimesFor, signoffMatrices } from "@/lib/makerspace";
import { reportPeriod } from "@/components/assets/ops/period";

export async function loadAssetsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/assets">) {
const {workspaceSlug}=await params;
const sp=await searchParams;
const a=await requireWorkspace(workspaceSlug,"MEMBER");
if(!canUseAssets(a.membership))notFound();
const [rows,pickers,keys]=await Promise.all([listAssets(a),opsPickers(a),isAdmin(a)?prisma.accessCredential.findMany({where:{workspaceId:a.workspace.id},orderBy:{label:"asc"}}):[]]);
const ids=rows.map(r=>r.id);
const period=reportPeriod(sp.from,sp.to);
const [downtimes,matrices,certTypes,costRows]=await Promise.all([downtimesFor(a,ids),signoffMatrices(a,ids),isAdmin(a)?prisma.certType.findMany({where:{workspaceId:a.workspace.id},select:{id:true,name:true},orderBy:{name:"asc"}}):[],isAdmin(a)?downtimeCostReport(a,period):[]]);
return viewDto({ a, rows, pickers, keys, period, downtimes, matrices, certTypes, costRows } as const);
}
