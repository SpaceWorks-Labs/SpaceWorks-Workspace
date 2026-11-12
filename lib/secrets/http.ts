import "server-only";
import { OpsError } from "@/lib/approvals/ops";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getClientIp, checkRateLimitById } from "@/lib/rateLimit";
import { sha256Hex } from "@/lib/crypto";
import { identityToken } from "./identities";
import { authenticateServiceToken } from "./tokens";
import { authenticateCliToken } from "./device";
import { type SecretsActor } from "./access";
import { SecretsError } from "./values";
export const privateHeaders = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export function secureHost(request: Request) {
  const base = new URL(process.env.NEXT_PUBLIC_BASE_URL ?? request.url);
  if (
    base.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  )
    throw new SecretsError("Use HTTPS to connect to Secrets.");
}
export async function apiLimit(
  request: NextRequest,
  write = false,
  subject?: string,
) {
  const bucket = write ? "apiWrite" : "apiRead";
  if (
    !(await checkRateLimitById(bucket, `secrets-ip:${getClientIp(request)}`)) ||
    (subject &&
      !(await checkRateLimitById(bucket, `secrets:${sha256Hex(subject)}`)))
  )
    throw new SecretsError("Too many requests. Try again shortly.");
}
export async function apiActor(
  request: NextRequest,
  projectId: string,
  write = false,
): Promise<SecretsActor> {
  secureHost(request);
  const raw = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_.-]{1,300})$/)?.[1];
  await apiLimit(request, write, raw);
  if (!raw) throw new SecretsError("Sign in or supply a service token.");
  if (raw.startsWith("swwu_")) {
    const actor = await identityToken(raw, getClientIp(request), projectId);
    if (!actor || !("workspace" in actor)) throw new SecretsError("This identity token is unavailable.");
    return actor;
  }
  if (raw.startsWith("swws_")) {
    const actor = await authenticateServiceToken(raw, getClientIp(request));
    const env = actor
      ? await prisma.secretEnvironment.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: actor.machine!.environmentId,
            projectId,
          },
        })
      : null;
    if (!actor || !env)
      throw new SecretsError(
        "This token is invalid or outside the requested scope.",
      );
    return actor;
  }
  const session = await authenticateCliToken(raw);
  if (!session)
    throw new SecretsError("Sign in again. This CLI session is unavailable.");
  const project = await prisma.secretProject.findUnique({
    where: { id: projectId },
    include: { workspace: true },
  });
  if (!project) throw new SecretsError("That project is unavailable.");
  const membership = await prisma.membership.findFirst({
    where: {
      workspaceId: project.workspaceId,
      userId: session.userId,
      status: "ACTIVE",
      user: { disabledAt: null },
      workspace: { status: "ACTIVE", archivedAt: null },
    },
  });
  if (!membership) throw new SecretsError("That project is unavailable.");
  return {
    user: { id: session.userId, name: session.user.name },
    workspace: project.workspace,
    membership,
    cliMfaAt: session.mfaAt,
  };
}
export function apiError(error: unknown) {
  const message =
    error instanceof SecretsError || error instanceof OpsError
      ? error.message
      : "Couldn't complete the request. Try again.";
  return Response.json(
    { error: message },
    {
      status: message.startsWith("Too many") ? 429 : 403,
      headers: privateHeaders,
    },
  );
}
export async function jsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.body) throw new SecretsError("Send a valid JSON request.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 250000) {
        await reader.cancel();
        throw new SecretsError("The request is too large.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new SecretsError("Send a valid JSON request.");
  }
}
export function browserOrigin(request: Request) {
  const expected = new URL(process.env.NEXT_PUBLIC_BASE_URL ?? request.url)
    .origin;
  if (
    request.headers.get("origin") !== expected ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    throw new SecretsError("This request is unavailable.");
}
