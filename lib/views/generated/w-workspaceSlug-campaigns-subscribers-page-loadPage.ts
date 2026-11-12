// Generated from app/w/[workspaceSlug]/campaigns/subscribers/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listLists } from "@/lib/campaigns/lists";
import { querySubscribers } from "@/lib/campaigns/subscribers";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
const { workspaceSlug } = await params;
const sp = await searchParams;
const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
const lists = await listLists(workspace.id);
const status = one("status") === "ACTIVE" || one("status") === "BLOCKLISTED" ? (one("status") as "ACTIVE" | "BLOCKLISTED") : undefined;
const listId = lists.some((l) => l.id === one("list")) ? one("list") : undefined;
const result = await querySubscribers(workspace.id, { q: one("q"), status, listId, page: Number(one("page")) || 1 });
const names = new Map(lists.map((l) => [l.id, l.name]));
const href = (page: number) => { const q = new URLSearchParams(Object.entries({ q: one("q"), status, list: listId, page: String(page) }).filter((e): e is [string, string] => Boolean(e[1]))); return `/w/${workspaceSlug}/campaigns/subscribers?${q}`; };
return viewDto({ lists, status, listId, result, names } as const);
}
