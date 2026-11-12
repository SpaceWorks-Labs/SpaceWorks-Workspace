import type { WorkspaceProvider } from "@/lib/observability/config";
import { PROVIDER_MODES } from "@/lib/observability/workspaceInput";

export const PROVIDER_COPY: Record<WorkspaceProvider, { title: string; blurb: string }> = {
  posthog: { title: "PostHog", blurb: "Product analytics with pseudonymous ids and templated page paths. No recordings." },
  clarity: { title: "Microsoft Clarity", blurb: "Session recordings. Only an owner can turn this on. Set masking to Strict in the Clarity dashboard." },
  grafana: { title: "Grafana", blurb: "A link to your dashboards. Nothing is sent." },
  metabase: { title: "Metabase", blurb: "Link to your reports, or embed dashboards from your own Metabase." },
};

export const MODE_LABEL: Record<string, string> = {
  inherit: "Use the instance setting",
  own: "Use this workspace's own account",
  off: "Off for this workspace",
  linkout: "Link only",
};

export const modesFor = (provider: WorkspaceProvider) => PROVIDER_MODES[provider];
