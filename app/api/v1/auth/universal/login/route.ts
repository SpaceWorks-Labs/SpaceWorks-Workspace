import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { workspaceHasModule } from "@/lib/modules-server";
import { getClientIp } from "@/lib/rateLimit";
import { universalLogin } from "@/lib/secrets/identities";
import { apiLimit, apiError, secureHost, privateHeaders, jsonBody } from "@/lib/secrets/http";
import { SecretsError } from "@/lib/secrets/values";
export async function POST(request: NextRequest) {
  try {
    secureHost(request);
    await apiLimit(request, true);
    const input = z.object({ clientId: z.string().max(100), clientSecret: z.string().max(300) }).safeParse(await jsonBody(request));
    if (!input.success) throw new SecretsError("Supply a client ID and client secret.");
    await apiLimit(request, true, input.data.clientId);
    const identity = await prisma.secretIdentity.findUnique({ where: { clientId: input.data.clientId }, select: { workspaceId: true } });
    if (identity && !(await workspaceHasModule(identity.workspaceId, "secrets"))) return Response.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
    return Response.json(await universalLogin(input.data.clientId, input.data.clientSecret, getClientIp(request)), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
