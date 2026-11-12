import { prisma } from "@/lib/db";

export type SendSettings = {
  trackOpens: boolean;
  trackClicks: boolean;
  individualTracking: boolean;
  sendPerMinute: number;
  batchSize: number;
  maxErrors: number;
  footerAddress: string;
};

/** Workspace campaign settings with the schema defaults when no row exists. */
export async function loadSendSettings(workspaceId: string): Promise<SendSettings> {
  const row = await prisma.campaignSettings.findUnique({ where: { workspaceId } });
  return {
    trackOpens: row?.trackOpens ?? false,
    trackClicks: row?.trackClicks ?? false,
    individualTracking: row?.individualTracking ?? false,
    sendPerMinute: Math.max(1, row?.sendPerMinute ?? 60),
    batchSize: Math.min(500, Math.max(1, row?.batchSize ?? 50)),
    maxErrors: Math.max(1, row?.maxErrors ?? 20),
    footerAddress: row?.footerAddress?.trim() ?? "",
  };
}
