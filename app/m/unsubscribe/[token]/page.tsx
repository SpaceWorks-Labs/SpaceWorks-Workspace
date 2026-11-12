import { notFound } from "next/navigation";
import { resolveUnsubscribeTarget } from "@/lib/campaigns/public/unsubscribe";
import { PublicShell, publicMetadata } from "@/components/campaigns/public/PublicShell";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Unsubscribe", ...publicMetadata };
export const dynamic = "force-dynamic";

export default async function Page({ params }: PageProps<"/m/unsubscribe/[token]">) {
  const { token } = await params;
  const target = await resolveUnsubscribeTarget(token);
  if (!target) notFound();
  const action = `/api/public/campaigns/unsubscribe/${encodeURIComponent(token)}`;
  return (
    <PublicShell title="Unsubscribe" intro={`Choose what you'd like to stop receiving from ${target.workspaceName}.`}>
      <form method="post" action={action} className="flex flex-col gap-3">
        <Button type="submit" name="choice" value="list" variant="primary">Unsubscribe from this list</Button>
        <Button type="submit" name="choice" value="all" variant="secondary">Unsubscribe from everything</Button>
        <Button type="submit" name="choice" value="prefs" variant="quiet">Manage my preferences</Button>
      </form>
    </PublicShell>
  );
}
