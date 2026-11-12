import { notFound } from "next/navigation";
import { loadPreferences } from "@/lib/campaigns/public/preferences";
import { PublicShell, publicMetadata } from "@/components/campaigns/public/PublicShell";
import { Callout } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { savePreferencesAction, unsubscribeAllAction } from "@/app/actions/campaignPreferences";

export const metadata = { title: "Email preferences", ...publicMetadata };
export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: PageProps<"/m/preferences/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  const view = await loadPreferences(token);
  if (!view) notFound();
  return (
    <PublicShell title="Email preferences" intro={`Choose what you hear about from ${view.workspaceName}.`}>
      {query.saved ? <Callout tone="success">Saved.</Callout> : null}
      {query.error ? <Callout tone="warning">That didn&apos;t save. Wait a moment and try again.</Callout> : null}
      {view.blocklisted ? <p className="text-body-ui">You&apos;ve unsubscribed from everything, so we won&apos;t email you.</p> : (
        <form action={savePreferencesAction.bind(null, token)} className="flex flex-col gap-4">
          <Field label="Your name" optional><Input name="name" defaultValue={view.name ?? ""} maxLength={160} /></Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-label text-ink">Lists</legend>
            {view.lists.length === 0 ? <p className="text-caption text-ink-muted">There are no public lists to choose from.</p> : null}
            {view.lists.map((l) => (
              <label key={l.id} className="flex min-h-11 items-start gap-3">
                <input type="checkbox" name="list" value={l.id} defaultChecked={l.subscribed || l.pending} className="mt-1 size-5" />
                <span><span className="text-ink">{l.name}</span>{l.pending ? <span className="ml-2 text-caption text-ink-muted">Waiting for confirmation</span> : null}{l.description ? <span className="block text-caption text-ink-muted">{l.description}</span> : null}</span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" variant="primary">Save preferences</Button>
        </form>
      )}
      {view.blocklisted ? null : (
        <form action={unsubscribeAllAction.bind(null, token)} className="mt-4 border-t border-line pt-4">
          <Button type="submit" variant="dangerQuiet">Unsubscribe from everything</Button>
        </form>
      )}
    </PublicShell>
  );
}
