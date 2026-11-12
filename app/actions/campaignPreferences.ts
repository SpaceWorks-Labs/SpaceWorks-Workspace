"use server";

// Public email-preference actions for /m/preferences/[token]; the signed token is the only credential.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getClientIpFromHeaders } from "@/lib/rateLimit";
import { loadPreferences, savePreferences } from "@/lib/campaigns/public/preferences";
import { unsubscribeEverywhere } from "@/lib/campaigns/public/unsubscribe";
import { checkRateLimitById } from "@/lib/rateLimit";

const path = (token: string, query = "") => `/m/preferences/${encodeURIComponent(token)}${query}`;

export async function savePreferencesAction(token: string, formData: FormData): Promise<void> {
  const ip = getClientIpFromHeaders(await headers());
  const ids = formData.getAll("list").filter((v): v is string => typeof v === "string").slice(0, 100);
  const ok = await savePreferences(token, { name: String(formData.get("name") ?? ""), subscribedListIds: ids }, ip);
  redirect(path(token, ok ? "?saved=1" : "?error=1"));
}

export async function unsubscribeAllAction(token: string): Promise<void> {
  const ip = getClientIpFromHeaders(await headers());
  const view = await loadPreferences(token);
  if (!view || !(await checkRateLimitById("campaignPublic", `prefs-ip:${ip}`))) redirect(path(token, "?error=1"));
  await unsubscribeEverywhere(view.workspaceId, view.subscriberId, "preferences");
  redirect("/m/done/unsubscribed");
}
