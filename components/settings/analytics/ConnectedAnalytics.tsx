import { Callout } from "@/components/ui/display";
import type { AnalyticsView } from "@/lib/observability/workspaceStore";
import { ProviderCard } from "./ProviderCard";

export function ConnectedAnalytics({ slug, view, isOwner }: { slug: string; view: AnalyticsView; isOwner: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {!view.overridesAllowed ? (
        <Callout tone="info" title="Using instance defaults">Your instance admin has not allowed per-workspace analytics settings. The tools below follow the instance configuration.</Callout>
      ) : null}
      {view.providers.map((provider) => (
        <ProviderCard
          key={provider.provider}
          slug={slug}
          view={provider}
          isOwner={isOwner}
          editable={view.overridesAllowed && view.listed.includes(provider.provider)}
          instanceActive={view.instanceActive[provider.provider]}
          hostAllowlist={view.hostAllowlist}
        />
      ))}
    </div>
  );
}
