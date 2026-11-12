// Generated from app/m/unsubscribe/[token]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { resolveUnsubscribeTarget } from "@/lib/campaigns/public/unsubscribe";

export async function loadPage({ params }: PageProps<"/m/unsubscribe/[token]">) {
const { token } = await params;
const target = await resolveUnsubscribeTarget(token);
if (!target) notFound();
const action = `/api/public/campaigns/unsubscribe/${encodeURIComponent(token)}`;
return viewDto({ target, action } as const);
}
