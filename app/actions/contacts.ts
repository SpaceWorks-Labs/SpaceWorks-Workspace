"use server";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { actionContext, isFailure, refreshArea } from "@/lib/people/actionContext";
import { addInteraction, deleteRelationship, exportOrganisations, exportRelationships, importContacts, importOrganisations, linkRecord, saveContact, saveDeal, saveOrganisation } from "@/lib/contacts/contacts";
import { idSchema } from "@/lib/validation";
export async function mutateContacts(slug: string, operation: string, input: unknown): Promise<ActionResult<unknown>> {
  const ctx = await actionContext(slug, "outreach"); if (isFailure(ctx)) return ctx;
  let result: ActionResult<unknown>;
  const data = input as { id?: unknown };
  const id = data?.id ? idSchema.safeParse(data.id) : null;
  if (id && !id.success) return actionError("Pick a record in this workspace.");
  const recordId = id?.success ? id.data : null;
  switch (operation) {
    case "contact": result = await saveContact(ctx, input, recordId); break;
    case "organisation": result = await saveOrganisation(ctx, input, recordId); break;
    case "deal": result = await saveDeal(ctx, input, recordId); break;
    case "interaction": result = await addInteraction(ctx, input); break;
    case "link": result = await linkRecord(ctx, input); break;
    case "delete": result = await deleteRelationship(ctx, input); break;
    case "import": result = await importContacts(ctx, input); break;
    case "importOrganisations": result = await importOrganisations(ctx, input); break;
    default: return actionError("That action is unavailable.");
  }
  if (result.ok) refreshArea(ctx.workspace.slug, "contacts", "organisations", "pipeline"); return result;
}
export async function exportContactsAction(slug: string, format: "csv" | "vcard", id?: string) {
  const ctx = await actionContext(slug, "outreach"); if (isFailure(ctx)) return ctx;
  if (format !== "csv" && format !== "vcard") return actionError("Choose CSV or vCard.");
  return exportRelationships(ctx, format, id);
}
export async function exportOrganisationsAction(slug: string) {
  const ctx = await actionContext(slug, "outreach"); if (isFailure(ctx)) return ctx;
  return exportOrganisations(ctx);
}
