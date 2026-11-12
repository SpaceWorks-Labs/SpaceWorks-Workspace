import { z } from "zod";
import { WORKSPACE_MODES, WORKSPACE_PROVIDERS, type WorkspaceMode, type WorkspaceProvider } from "./config";

/** Which modes each tool supports. */
export const PROVIDER_MODES: Record<WorkspaceProvider, readonly WorkspaceMode[]> = {
  posthog: ["inherit", "own", "off"],
  clarity: ["inherit", "own", "off"],
  grafana: ["inherit", "linkout", "off"],
  metabase: ["inherit", "own", "linkout", "off"],
};

const text = (max: number) => z.string().trim().max(max).optional();

export const workspaceConnectionSchema = z.object({
  provider: z.enum(WORKSPACE_PROVIDERS),
  mode: z.enum(WORKSPACE_MODES),
  /** "I am responsible for telling members this workspace uses this tool." */
  acknowledged: z.boolean(),
  key: text(120),
  host: text(255),
  projectId: text(40),
  url: text(2000),
  siteUrl: text(255),
  dashboardIds: text(300),
  /** Write-only. Empty keeps the stored secret. */
  secret: text(2000),
  clearSecret: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (!PROVIDER_MODES[value.provider].includes(value.mode)) ctx.addIssue({ code: "custom", path: ["mode"], message: "That option is not available for this tool." });
  if (value.mode !== "off" && !value.acknowledged) ctx.addIssue({ code: "custom", path: ["acknowledged"], message: "Confirm that you will tell members this workspace uses this tool." });
});

export type WorkspaceConnectionInput = z.infer<typeof workspaceConnectionSchema>;
