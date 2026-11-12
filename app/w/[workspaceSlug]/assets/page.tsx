import { notFound } from "next/navigation";
import QRCode from "qrcode";
import Image from "next/image";
import { requireWorkspace, canUseAssets } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { listAssets } from "@/lib/assets/service";
import { isAdmin } from "@/lib/approvals/context";
import { opsPickers } from "@/lib/approvals/pickers";
import { saveInventory, addMaintenance, savePhysicalKey } from "@/app/actions/assets";
import { OpsForm } from "@/components/requests/OpsForm";
import { OpsLayout, Editor, Empty, choices, words } from "@/components/requests/OpsLayout";
import { Card, Chip } from "@/components/ui/display";
import { formatDate } from "@/lib/format/datetime";
import { downtimeCostReport, downtimesFor, signoffMatrices } from "@/lib/makerspace";
import { AssetOps } from "@/components/assets/ops/AssetOps";
import { CostReport } from "@/components/assets/ops/CostReport";
import { DowntimeChip } from "@/components/assets/ops/DowntimeChip";
import { reportPeriod } from "@/components/assets/ops/period";
export const metadata = { title: "Assets and equipment" };
export default async function AssetsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/assets">) {
 const {workspaceSlug}=await params; const sp=await searchParams; const a=await requireWorkspace(workspaceSlug,"MEMBER"); if(!canUseAssets(a.membership))notFound();
 const [rows,pickers,keys]=await Promise.all([listAssets(a),opsPickers(a),isAdmin(a)?prisma.accessCredential.findMany({where:{workspaceId:a.workspace.id},orderBy:{label:"asc"}}):[]]);
 const ids=rows.map(r=>r.id); const period=reportPeriod(sp.from,sp.to);
 const [downtimes,matrices,certTypes,costRows]=await Promise.all([downtimesFor(a,ids),signoffMatrices(a,ids),isAdmin(a)?prisma.certType.findMany({where:{workspaceId:a.workspace.id},select:{id:true,name:true},orderBy:{name:"asc"}}):[],isAdmin(a)?downtimeCostReport(a,period):[]]);
 return <OpsLayout slug={workspaceSlug} title="Assets and equipment" description={`Track internal equipment and maintenance. Dates use ${a.workspace.timezone}.`}>
  <a href={`/w/${workspaceSlug}/money-controls/assets`} className="inline-flex min-h-11 items-center text-accent-text underline">Assignments, verification and fixed-asset schedule</a>
  {isAdmin(a)&&<Editor title="Add equipment" open={!rows.length}><OpsForm action={saveInventory.bind(null,workspaceSlug)} label="Add equipment" fields={[{name:"name",label:"Name",required:true},{name:"category",label:"Category",required:true},{name:"location",label:"Location"},{name:"condition",label:"Condition"}]} /></Editor>}
  {isAdmin(a)&&<CostReport rows={costRows} from={period.fromInput} to={period.toInput} currency={a.workspace.currency??"INR"} />}
  {!rows.length&&<Empty patch>No equipment yet. Ask an admin to add the first item.</Empty>}
  {await Promise.all(rows.map(async r=>{ const qr = await QRCode.toDataURL(`${process.env.NEXT_PUBLIC_BASE_URL??"http://localhost:3220"}/a/${r.tag}`,{width:160,margin:2}); return <Card key={r.id} id={r.id}><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-h4">{r.name}</h2><p className="mt-2 text-body-ui text-ink-muted">{r.category} · {r.location??"No location"} · {r.condition??"Condition not recorded"}</p></div><div className="flex flex-wrap items-start gap-2"><DowntimeChip down={Boolean(downtimes.get(r.id)?.current)} /><Chip>{words(r.status)}</Chip></div></div><details className="mt-4"><summary className="min-h-11 cursor-pointer text-label">QR label</summary><div className="inline-block bg-panel p-3"><Image unoptimized width={160} height={160} alt={`Equipment label for ${r.name}`} src={qr} /><p className="text-caption">{r.name}</p></div><a href={`/a/${r.tag}`} className="block min-h-11 text-accent-text underline">Open equipment link</a></details>
  <AssetOps slug={workspaceSlug} assetId={r.id} downtime={downtimes.get(r.id)??{current:null,history:[]}} matrix={matrices.get(r.id)!} allTypes={certTypes} canManage={isAdmin(a)} timeZone={a.workspace.timezone} />
  {isAdmin(a)&&<details className="mt-4"><summary className="min-h-11 cursor-pointer text-label">Inventory and maintenance</summary><OpsForm action={saveInventory.bind(null,workspaceSlug)} hidden={{id:r.id}} label="Update equipment" fields={[{name:"name",label:"Name",value:r.name,required:true},{name:"category",label:"Category",value:r.category,required:true},{name:"location",label:"Location",value:r.location??""},{name:"condition",label:"Condition",value:r.condition??""},{name:"status",label:"Status",value:r.status,required:true,options:choices(["AVAILABLE","IN_MAINTENANCE","LOST","RETIRED"])}]} /><div className="mt-6"><OpsForm action={addMaintenance.bind(null,workspaceSlug)} hidden={{assetId:r.id}} label="Log maintenance" fields={[{name:"type",label:"Work type",value:"SERVICE",required:true,options:choices(["REPAIR","SERVICE","INSPECTION","NOTE"])},{name:"note",label:"Maintenance note",required:true,type:"textarea"},{name:"cost",label:"Cost"},{name:"nextDueAt",label:"Next due",type:"date"}]} /></div>{r.maintenance.map(m=><p key={m.id} className="mt-3 text-body-ui">{formatDate(m.at,a.workspace.timezone)}: {m.note}</p>)}</details>}
  </Card>;}))}
  {isAdmin(a)&&<><Editor title="Register a physical key"><OpsForm action={savePhysicalKey.bind(null,workspaceSlug)} label="Save key" fields={[{name:"label",label:"Label",required:true},{name:"type",label:"Type",value:"KEY",required:true,options:choices(["KEY","FOB","CARD","CODE"])},{name:"area",label:"Area"},{name:"holderUserId",label:"Holder",options:pickers.members},{name:"status",label:"Status",value:"IN_SAFE",required:true,options:choices(["ISSUED","IN_SAFE","LOST","RETIRED"])}]} /><p className="mt-3 text-caption text-ink-muted">Keep door codes in the vault; record only the label here.</p></Editor>{keys.map(k=><Card key={k.id}><h2 className="text-title">{k.label}</h2><p className="my-2 text-body-ui">{words(k.type)} · {k.area} · {words(k.status)}</p><OpsForm action={savePhysicalKey.bind(null,workspaceSlug)} label="Update holder" hidden={{id:k.id,label:k.label,type:k.type,area:k.area??""}} fields={[{name:"holderUserId",label:"Holder",value:k.holderUserId??"",options:pickers.members},{name:"status",label:"Status",value:k.status,required:true,options:choices(["ISSUED","IN_SAFE","LOST","RETIRED"])}]} /></Card>)}</>}
 </OpsLayout>;
}
