"use server";
import { z } from "zod";
import { revalidatePath } from "@/lib/frontend/cache";
import { prisma } from "@/lib/db";
import { integrationAccess } from "@/lib/integrations/access";
import { searchConsoleSites, googleApi, searchConsoleUrl } from "@/lib/integrations/google/api";
import { findGoogleConnection } from "@/lib/integrations/google/tokens";
import { belongsToProperty } from "@/lib/seo/audit";
import { syncSeoSite, runSeoAudit } from "@/lib/seo/service";
import { recordAuditEvent } from "@/lib/audit";
import type { ActionResult } from "@/lib/actionResult";
export async function updateSeo(slug: string, raw: unknown): Promise<ActionResult<{ output?: string }>> {
  try {
    const { workspace, user } = await integrationAccess(slug, "ADMIN", "social"); const workspaceId = workspace.id;
    const input = z.object({ operation: z.enum(["connect", "sync", "audit", "inspect", "sitemaps", "submitSitemap"]), siteId: z.string().max(64).optional(), url: z.string().max(2048).optional() }).parse(raw); let output: string | undefined;
    if (input.operation === "connect") {
      const available = await searchConsoleSites(workspaceId); const connection = await findGoogleConnection(workspaceId);
      if (!connection) throw new Error("Connect Google first.");
      for (const site of available.siteEntry ?? []) {
        if (site.permissionLevel === "siteUnverifiedUser") continue;
        await prisma.seoSite.upsert({ where: { workspaceId_siteUrl: { workspaceId, siteUrl: site.siteUrl } }, create: { workspaceId, siteUrl: site.siteUrl, connectionId: connection.id, verified: true }, update: { connectionId: connection.id, verified: true } });
      }
      output = "Search Console sites connected.";
    } else {
      const site = await prisma.seoSite.findFirst({ where: { id: input.siteId ?? "", workspaceId } }); if (!site) throw new Error("Pick a site in this workspace.");
      if (input.operation === "sync") await syncSeoSite(workspaceId, site.id);
      if (input.operation === "audit") { const url = z.url().parse(input.url); const result = await runSeoAudit(workspaceId, site.id, user.id, url); output = `Audit score: ${result.score}/100`; }
      if (["inspect", "submitSitemap"].includes(input.operation)) {
        const url = z.url().parse(input.url);
        const belongs = belongsToProperty(site.siteUrl, url);
        if (!belongs) throw new Error("Use a URL that belongs to this Search Console property.");
        if (input.operation === "inspect") { const result = await googleApi(workspaceId, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", connectionId: site.connectionId ?? undefined, body: { inspectionUrl: url, siteUrl: site.siteUrl, languageCode: "en-GB" } }); output = JSON.stringify(result, null, 2); }
        else { await googleApi(workspaceId, searchConsoleUrl(site.siteUrl, `/sitemaps/${encodeURIComponent(url)}`), { method: "PUT", connectionId: site.connectionId ?? undefined }); output = "Sitemap submitted."; }
      }
      if (input.operation === "sitemaps") { const result = await googleApi(workspaceId, searchConsoleUrl(site.siteUrl, "/sitemaps"), { connectionId: site.connectionId ?? undefined }); output = JSON.stringify(result, null, 2); }
    }
    await recordAuditEvent({ workspaceId, actorId: user.id, action: `integrations.seo_${input.operation}`, targetId: input.siteId }); revalidatePath(`/w/${slug}/seo`);
    return { ok: true, data: { output } };
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? "Check the site and page URL." : error instanceof Error && error.name === "Error" && !error.message.toLowerCase().includes("prisma") ? error.message.slice(0, 200) : "Couldn't update SEO data. Try again." }; }
}
