"use server";
import { list, runAction, values } from "@/lib/approvals/action";
import { endDowntime, startDowntime } from "@/lib/makerspace/downtime";
import { setCertRequirements } from "@/lib/makerspace/certRequirements";

export async function markOutOfService(slug: string, form: FormData) {
  return runAction(slug, "assets", async (a) => { await startDowntime(a, values(form)); return "Marked out of service."; }, true);
}
export async function markBackInService(slug: string, form: FormData) {
  return runAction(slug, "assets", async (a) => { await endDowntime(a, values(form)); return "Back in service."; }, true);
}
export async function saveRequiredInductions(slug: string, form: FormData) {
  return runAction(slug, "assets", async (a) => { await setCertRequirements(a, { assetId: String(form.get("assetId") ?? ""), certTypeIds: list(form, "certTypeIds") }); }, true);
}
