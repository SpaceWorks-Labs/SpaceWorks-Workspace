import "server-only";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { getObsSettings } from "./keys";
import { parseLinkoutUrl } from "./hosts";
import { DASHBOARD_ID, resolveWorkspaceConnection, validateOwnConnection } from "./workspaceConfig";
import type { WorkspaceProvider } from "./config";
import { WORKSPACE_PROVIDERS } from "./config";
import type { WorkspaceConnectionInput } from "./workspaceInput";

export type SaveResult = { ok: true; secretChanged: boolean; mode: string } | { ok: false; error: string; field?: string };

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

function publicConfigFor(input: WorkspaceConnectionInput): Record<string, unknown> {
  if (input.mode === "linkout") return { url: input.url ?? "" };
  if (input.mode !== "own") return {};
  switch (input.provider) {
    case "posthog": return { key: input.key ?? "", host: input.host ?? "" };
    case "clarity": return { projectId: input.projectId ?? "" };
    case "metabase": return { siteUrl: input.siteUrl ?? "", dashboardIds: (input.dashboardIds ?? "").split(/[\s,]+/).filter((id) => DASHBOARD_ID.test(id)) };
    default: return {};
  }
}

/** Validate and store one provider's connection. The caller has already checked ADMIN. */
export async function saveWorkspaceConnection(args: { workspaceId: string; actorId: string; role: WorkspaceRole; input: WorkspaceConnectionInput }): Promise<SaveResult> {
  const { workspaceId, actorId, role, input } = args;
  const settings = await getObsSettings();
  if (!settings.overrides.allowed || !settings.overrides.providers.includes(input.provider)) {
    return { ok: false, error: "Your instance admin has not allowed workspace settings for this tool." };
  }
  if (input.provider === "clarity" && input.mode !== "off" && role !== "OWNER") return { ok: false, error: "Only a workspace owner can turn on Clarity." };
  const existing = await prisma.workspaceAnalyticsConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: input.provider } } });
  let secretEnc = existing?.secretEnc ?? null;
  if (input.clearSecret) secretEnc = null;
  if (input.secret) secretEnc = encryptSecret("workspace-analytics", input.secret);
  if (input.mode !== "own" || input.provider !== "metabase") secretEnc = null;
  const publicConfig = publicConfigFor(input);
  if (input.mode === "own") {
    const check = await validateOwnConnection(input.provider, { publicConfig, secretEnc }, settings, { dns: true });
    if (!check.ok) return { ok: false, error: check.error };
  }
  if (input.mode === "linkout") {
    const link = parseLinkoutUrl(input.url ?? "");
    if (!link.ok) return { ok: false, error: link.error, field: "url" };
    publicConfig.url = link.url;
  }
  const data = {
    enabled: input.mode !== "off",
    mode: input.mode,
    publicConfig: { ...publicConfig, ...(input.mode === "off" ? {} : { acknowledgedAt: new Date().toISOString(), acknowledgedById: actorId }) } as Prisma.InputJsonValue,
    secretEnc,
    updatedById: actorId,
  };
  await prisma.workspaceAnalyticsConnection.upsert({
    where: { workspaceId_provider: { workspaceId, provider: input.provider } },
    create: { workspaceId, provider: input.provider, ...data },
    update: data,
  });
  return { ok: true, secretChanged: secretEnc !== (existing?.secretEnc ?? null), mode: input.mode };
}

export type ProviderView = {
  provider: WorkspaceProvider;
  mode: string;
  enabled: boolean;
  /** Public fields only. Secrets are never included, only whether one is stored. */
  fields: { key?: string; host?: string; projectId?: string; url?: string; siteUrl?: string; dashboardIds?: string };
  hasSecret: boolean;
  acknowledged: boolean;
  effective: { source: string; active: boolean; reason: string | null; linkUrl: string | null };
};

export type AnalyticsView = {
  overridesAllowed: boolean;
  listed: WorkspaceProvider[];
  hostAllowlist: string[];
  instanceActive: Record<WorkspaceProvider, boolean>;
  providers: ProviderView[];
};

export async function getWorkspaceAnalyticsView(workspaceId: string): Promise<AnalyticsView> {
  const settings = await getObsSettings();
  const rows = await prisma.workspaceAnalyticsConnection.findMany({ where: { workspaceId } });
  const providers: ProviderView[] = [];
  const instanceActive = {} as Record<WorkspaceProvider, boolean>;
  for (const provider of WORKSPACE_PROVIDERS) {
    const row = rows.find((r) => r.provider === provider) ?? null;
    const cfg = asRecord(row?.publicConfig);
    const ids = Array.isArray(cfg.dashboardIds) ? cfg.dashboardIds.map(String).join(", ") : undefined;
    const effective = await resolveWorkspaceConnection(provider, workspaceId, { settings, row });
    instanceActive[provider] = (await resolveWorkspaceConnection(provider, workspaceId, { settings: { ...settings, overrides: { ...settings.overrides, allowed: false } }, row: null })).active;
    providers.push({
      provider, mode: row?.mode ?? "inherit", enabled: row?.enabled ?? false,
      fields: { key: cfg.key as string | undefined, host: cfg.host as string | undefined, projectId: cfg.projectId as string | undefined, url: cfg.url as string | undefined, siteUrl: cfg.siteUrl as string | undefined, dashboardIds: ids },
      hasSecret: Boolean(row?.secretEnc), acknowledged: Boolean(cfg.acknowledgedAt),
      effective: { source: effective.source, active: effective.active, reason: effective.reason ?? null, linkUrl: effective.source === "linkout" ? effective.config.url ?? null : effective.provider === "grafana" ? effective.config.url ?? null : null },
    });
  }
  return { overridesAllowed: settings.overrides.allowed, listed: settings.overrides.providers, hostAllowlist: settings.overrides.hostAllowlist, instanceActive, providers };
}
