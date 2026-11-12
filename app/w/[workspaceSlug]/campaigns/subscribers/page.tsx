import Link from "next/link";
import { CampaignTabs } from "@/components/campaigns/CampaignTabs";
import { AddSubscriber } from "@/components/campaigns/subscribers/AddSubscriber";
import { SubscriberTable } from "@/components/campaigns/subscribers/SubscriberTable";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/display";
import { Input } from "@/components/ui/field";
import { listLists } from "@/lib/campaigns/lists";
import { querySubscribers } from "@/lib/campaigns/subscribers";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Subscribers" };

export default async function Page({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Email campaigns" description={`${result.total} subscribers`} actions={<Button asChild variant="secondary"><Link href={`/w/${workspaceSlug}/campaigns/subscribers/import`}>Import</Link></Button>} />
      <CampaignTabs slug={workspaceSlug} />
      <form className="flex flex-wrap items-end gap-3" role="search">
        <Input name="q" defaultValue={one("q")} placeholder="Search email or name" aria-label="Search subscribers" className="max-w-xs" />
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className="min-h-11 rounded-[10px] border border-line-strong bg-panel px-3"><option value="">Any status</option><option value="ACTIVE">Active</option><option value="BLOCKLISTED">Blocklisted</option></select>
        <select name="list" defaultValue={listId ?? ""} aria-label="List" className="min-h-11 rounded-[10px] border border-line-strong bg-panel px-3"><option value="">Any list</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {result.rows.length === 0 ? <EmptyState title="No subscribers match.">Add someone below or import a CSV.</EmptyState> : (
        <SubscriberTable slug={workspaceSlug} rows={result.rows.map((r) => ({ id: r.id, email: r.email, name: r.name, status: r.status, blocklistReason: r.blocklistReason, lists: r.subscriptions.filter((s) => s.status === "CONFIRMED").map((s) => names.get(s.listId)).filter((n): n is string => Boolean(n)) }))} />
      )}
      {result.pages > 1 ? (
        <nav className="flex items-center gap-3" aria-label="Pages">
          {result.page > 1 ? <Link className="text-accent-text underline" href={href(result.page - 1)}>Previous</Link> : null}
          <span className="text-caption text-ink-muted">Page {result.page} of {result.pages}</span>
          {result.page < result.pages ? <Link className="text-accent-text underline" href={href(result.page + 1)}>Next</Link> : null}
        </nav>
      ) : null}
      <section className="flex flex-col gap-3"><SectionHeading title="Add a subscriber" /><AddSubscriber slug={workspaceSlug} lists={lists.map((l) => ({ id: l.id, name: l.name }))} /></section>
    </div>
  );
}
