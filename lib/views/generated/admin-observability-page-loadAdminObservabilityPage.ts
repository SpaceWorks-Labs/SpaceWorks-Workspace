// Generated from app/admin/observability/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { getProviderStatus } from "@/lib/observability";
import { PROVIDER_IDS } from "@/lib/observability/admin/providers";
import { getConsoleData } from "@/lib/observability/admin/settings";
import { instanceEmbed } from "@/lib/observability/metabase/embed";
import { requireSuperAdminMfa } from "@/lib/permissions";

export async function loadAdminObservabilityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
await requireSuperAdminMfa();
const raw = (await searchParams).dashboard;
const wanted = Number(Array.isArray(raw) ? raw[0] : raw);
const [data, embed, statuses] = await Promise.all([
    getConsoleData(),
    instanceEmbed(Number.isSafeInteger(wanted) ? wanted : undefined),
    Promise.all(PROVIDER_IDS.map(async (id) => {
      try {
        const s = await getProviderStatus(id);
        return [id, !s.enabled ? "Off." : s.configured ? "Ready." : `Missing: ${s.missing.join(", ")}.`] as const;
      } catch { return [id, "Status unavailable."] as const; }
    })),
  ]);
const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
return viewDto({ data, embed, statuses, baseUrl } as const);
}
