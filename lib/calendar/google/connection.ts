import "server-only";

import { prisma } from "@/lib/db";
import { getGoogleAccessToken } from "@/lib/integrations/google/tokens";
import { requestJson } from "@/lib/integrations/http";
import { ensure } from "@/lib/meetings/core";
import type { Busy } from "../algorithms";

export const API = "https://www.googleapis.com/calendar/v3";
export async function memberGoogle(workspaceId: string, userId: string) {
  return prisma.integrationConnection.findFirst({
    where: {
      workspaceId,
      connectedById: userId,
      provider: "GOOGLE",
      status: "ACTIVE",
      workspace: { status: "ACTIVE", archivedAt: null },
      connectedBy: {
        disabledAt: null,
        memberships: { some: { workspaceId, status: "ACTIVE" } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
export async function googleBusy(
  workspaceId: string,
  userId: string,
  start: Date,
  end: Date,
): Promise<Busy[]> {
  const connection = await memberGoogle(workspaceId, userId);
  if (!connection) return [];
  const token = await getGoogleAccessToken(connection);
  ensure(token.ok, "Reconnect Google to check availability.");
  const response = await requestJson<{
    calendars?: Record<
      string,
      { busy?: { start: string; end: string }[]; errors?: unknown[] }
    >;
  }>(`${API}/freeBusy`, {
    method: "POST",
    label: "Google Calendar",
    headers: { Authorization: `Bearer ${token.token}` },
    body: {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: "primary" }],
    },
  });
  ensure(
    response.ok &&
      response.data.calendars?.primary &&
      !response.data.calendars.primary.errors?.length,
    "Google availability is unavailable. Try again.",
  );
  return (response.data.calendars?.primary?.busy ?? []).map((b) => ({
    ...b,
    userId,
  }));
}
export type GoogleEvent = {
  conferenceData?: { createRequest?: { status?: { statusCode?: string } }; entryPoints?: { entryPointType?: string; uri?: string }[] };
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  location?: string;
  hangoutLink?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
};
