"use server";
import { runAction, values } from "@/lib/approvals/action";
import { parseMoneyToMinor } from "@/lib/format/money";
import { OpsError } from "@/lib/approvals/ops";
import { saveAsset, logMaintenance, saveKey } from "@/lib/assets/service";
export async function saveInventory(slug: string, form: FormData) { return runAction(slug, "assets", async a => { await saveAsset(a, values(form)); }, true); }
export async function addMaintenance(slug: string, form: FormData) { return runAction(slug, "assets", async a => { const v: Record<string, string> = { ...values(form) }; const cost = v.cost?.trim(); delete v.cost; if (cost) { const minor = parseMoneyToMinor(cost, a.workspace.currency ?? "INR"); if (minor === null) throw new OpsError("Enter a valid cost for this currency."); v.costMinor = String(minor); } await logMaintenance(a, v); }, true); }
export async function savePhysicalKey(slug: string, form: FormData) { return runAction(slug, "assets", async a => { await saveKey(a, values(form)); }, true); }
