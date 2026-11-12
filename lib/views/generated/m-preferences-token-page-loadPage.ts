// Generated from app/m/preferences/[token]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { loadPreferences } from "@/lib/campaigns/public/preferences";

export async function loadPage({ params, searchParams }: PageProps<"/m/preferences/[token]">) {
const { token } = await params;
const query = await searchParams;
const view = await loadPreferences(token);
if (!view) notFound();
return viewDto({ view } as const);
}
