import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolvePublicWorkspace } from "@/lib/campaigns/public/gate";
import { issueFormToken } from "@/lib/campaigns/public/formToken";
import { PublicShell, publicMetadata } from "@/components/campaigns/public/PublicShell";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Subscribe", ...publicMetadata };
export const dynamic = "force-dynamic";

export default async function Page({ params }: PageProps<"/m/[workspaceSlug]/subscribe/[listSlug]">) {
  const { workspaceSlug, listSlug } = await params;
  const workspace = await resolvePublicWorkspace({ slug: workspaceSlug });
  if (!workspace) notFound();
  const list = await prisma.mailingList.findUnique({ where: { workspaceId_slug: { workspaceId: workspace.id, slug: listSlug } } });
  if (!list || list.visibility !== "PUBLIC" || list.archivedAt) notFound();
  return (
    <PublicShell title={`Subscribe to ${list.name}`} intro={list.description ?? `Email updates from ${workspace.name}.`}>
      <form method="post" action="/api/public/campaigns/subscribe" className="flex flex-col gap-4">
        <input type="hidden" name="workspaceSlug" value={workspace.slug} />
        <input type="hidden" name="listSlug" value={list.slug} />
        <input type="hidden" name="ts" value={issueFormToken(workspace.id, list.id)} />
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>Leave this empty<input name="hp" tabIndex={-1} autoComplete="off" /></label>
        </div>
        <Field label="Your name" optional><Input name="name" maxLength={160} autoComplete="name" /></Field>
        <Field label="Email address" required><Input name="email" type="email" required maxLength={254} autoComplete="email" /></Field>
        <p className="text-caption text-ink-muted">We&apos;ll email you a link to confirm. Every email has an unsubscribe link.</p>
        <Button type="submit" variant="primary">Subscribe</Button>
      </form>
    </PublicShell>
  );
}
