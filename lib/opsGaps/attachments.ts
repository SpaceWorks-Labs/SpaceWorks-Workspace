import "server-only";
import { z } from "zod";
import type { WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { deleteObjects, uploadWorkspaceFile } from "@/lib/storage";
import { admin, audit, guard, OperationsError, parse, unavailable, write, type OpsActor } from "./context";
import { ticketWhere } from "./helpdesk";
import { id } from "./rules";
export const OPS_FILE_FOLDER = "/people-service";
export const EVIDENCE_TYPES = new Set(["image/png","image/jpeg","image/webp","image/gif","application/pdf"]);
const kindSchema=z.enum(["ticket","safety","candidate","lease","inspection","hours","leave"]);
export type AttachmentKind=z.infer<typeof kindSchema>;
export async function canReadRecord(actor:OpsActor,kind:AttachmentKind,recordId:string,tx:DbClient=prisma){
 const where={workspaceId:actor.workspace.id,id:recordId};
 switch(kind){
  case "ticket":return Boolean(await tx.helpTicket.findFirst({where:{...ticketWhere(actor),id:recordId},select:{id:true}}));
  case "safety":return Boolean(await tx.safetyReport.findFirst({where:{...where,...(admin(actor)?{}:{reporterId:actor.user.id})},select:{id:true}}));
  case "candidate":return admin(actor)&&Boolean(await tx.hiringCandidate.findFirst({where,select:{id:true}}));
  case "lease":return admin(actor)&&Boolean(await tx.facilityLease.findFirst({where,select:{id:true}}));
  case "inspection":return admin(actor)&&Boolean(await tx.checklistRun.findFirst({where:{...where,items:{some:{sourceType:"safety_inspection"}}},select:{id:true}}));
  case "hours":return Boolean(await tx.volunteerLog.findFirst({where:{...where,...(admin(actor)?{}:{userId:actor.user.id})},select:{id:true}}));
  case "leave":return Boolean(await tx.checklistRun.findFirst({where:{...where,...(admin(actor)?{}:{subjectUserId:actor.user.id}),items:{some:{sourceType:"availability_request"}}},select:{id:true}}));
 }
}
export async function listAttachments(actor:OpsActor,kind:AttachmentKind,recordId:string){
 await guard(actor);if(!await canReadRecord(actor,kind,recordId))throw unavailable();
 return prisma.opsAttachment.findMany({where:{workspaceId:actor.workspace.id,kind,recordId,file:{deletedAt:null}},select:{file:{select:{id:true,filename:true,contentType:true,size:true}}},orderBy:{createdAt:"asc"}});
}
export async function attachFiles(actor:OpsActor,input:{kind:unknown;recordId:unknown;files:File[]}){
 const v=parse(z.object({kind:kindSchema,recordId:id}),input);
 await guard(actor);if(!await canReadRecord(actor,v.kind,v.recordId))throw unavailable();
 if(input.files.reduce((n,f)=>n+f.size,0)>25*1024*1024)throw new OperationsError("Choose files totalling 25 MB or less.");
 if(input.files.length<1||input.files.length>10)throw new OperationsError("Choose between 1 and 10 files.");
 // Upload and link in one transaction. Rollback removes new objects as well.
 const stored:string[]=[];
 try{return await write(actor,`attachments:${v.kind}:${v.recordId}`,false,async tx=>{
  if(!await canReadRecord(actor,v.kind,v.recordId,tx))throw unavailable();
  if(await tx.opsAttachment.count({where:{workspaceId:actor.workspace.id,kind:v.kind,recordId:v.recordId}})+input.files.length>30)throw new OperationsError("Keep each record within 30 attachments.");
  for(const file of input.files){
   const result=await uploadWorkspaceFile({workspaceId:actor.workspace.id,uploadedById:actor.user.id,file,folder:OPS_FILE_FOLDER,allowedTypes:EVIDENCE_TYPES,client:tx});
   if(!result.ok)throw new OperationsError(result.error);stored.push(result.file.storageKey);
   await tx.opsAttachment.create({data:{workspaceId:actor.workspace.id,kind:v.kind,recordId:v.recordId,fileId:result.file.id}});
  }await audit(actor,v.kind,v.recordId,"files_attached",tx);
 });}catch(error){await deleteObjects(stored).catch(()=>undefined);throw error;}
}
/** Called by the authorised file route. Reserved-folder orphans fail closed. */
export async function canDownloadOpsFile(file:{id:string;workspaceId:string;folder?:string},userId:string,role:WorkspaceRole,viaSuperAdmin=false){
 const link=await prisma.opsAttachment.findFirst({where:{workspaceId:file.workspaceId,fileId:file.id}});
 if(!link)return file.folder!==OPS_FILE_FOLDER&&!file.folder?.startsWith(`${OPS_FILE_FOLDER}/`);
 if(role==="GUEST")return false;
 const kind=kindSchema.safeParse(link.kind);if(!kind.success)return false;
 const actor={user:{id:userId,name:null},workspace:{id:file.workspaceId,slug:"",name:"",timezone:"UTC"},membership:{role,...(viaSuperAdmin?{viaSuperAdmin:true}:{})}};
 return canReadRecord(actor,kind.data,link.recordId);
}
