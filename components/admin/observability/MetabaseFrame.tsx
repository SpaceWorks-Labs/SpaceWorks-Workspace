import { Callout } from "@/components/ui/display";

type Props = { title: string; embedUrl: string | null; linkUrl: string | null; reason?: string };

/**
 * A signed Metabase dashboard in a sandboxed iframe. The caller passes
 * `embedUrl` only when the CSP lets that origin be framed; otherwise this
 * shows a link-out.
 */
export function MetabaseFrame({ title, embedUrl, linkUrl, reason }: Props) {
  if (embedUrl) {
    return <iframe title={title} src={embedUrl} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" className="h-[70vh] w-full rounded-lg border border-line bg-panel" />;
  }
  return (
    <Callout tone="info" title="Open this report in Metabase">
      {reason ?? "This report can't be shown here."}
      {linkUrl ? (
        <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-caption underline underline-offset-4">
          Open Metabase (new tab)
        </a>
      ) : null}
    </Callout>
  );
}
