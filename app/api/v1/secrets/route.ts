import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { workspaceHasModule } from "@/lib/modules-server";
import {
  apiActor,
  privateHeaders,
  apiError,
  jsonBody,
} from "@/lib/secrets/http";
import { environmentAccess, checkPath } from "@/lib/secrets/access";
import { readSecrets, changeSecrets } from "@/lib/secrets/service";
import {
  formatSecrets,
  normalisePath,
  SecretsError,
  KEY_PATTERN,
} from "@/lib/secrets/values";
const moduleOff = () => Response.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams,
      projectId = q.get("project") ?? "";
    const actor = await apiActor(request, projectId);
    if (!(await workspaceHasModule(actor.workspace.id, "secrets"))) return moduleOff();
    const environment = q.get("environment") ?? "dev",
      path = normalisePath(q.get("path") ?? "/");
    const env = await prisma.secretEnvironment.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        projectId,
        OR: [{ id: environment }, { slug: environment }],
      },
    });
    if (!env) throw new SecretsError("That environment is unavailable.");
    if (q.get("list") === "true") {
      await environmentAccess(actor, env.id, "KEYS");
      checkPath(actor, path, env.id, false, true);
      const rows = await prisma.applicationSecret.findMany({
        where: {
          workspaceId: actor.workspace.id,
          environmentId: env.id,
          path,
          deletedAt: null,
        },
        select: { key: true },
        orderBy: { key: "asc" },
      });
      return Response.json(
        { keys: rows.map((r) => r.key) },
        { headers: privateHeaders },
      );
    }
    const key = q.get("key") ?? undefined;
    if (key && !KEY_PATTERN.test(key))
      throw new SecretsError("Use a valid key name.");
    const values = await readSecrets(actor, env.id, path, {
      key,
      exporting: !key,
    });
    const format = q.get("format") ?? "json";
    return new Response(formatSecrets(values, format), {
      headers: {
        ...privateHeaders,
        "Content-Type":
          format === "json"
            ? "application/json; charset=utf-8"
            : "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const body = await jsonBody(request);
    const projectId = String(body.project ?? "");
    const actor = await apiActor(request, projectId, true);
    if (!(await workspaceHasModule(actor.workspace.id, "secrets"))) return moduleOff();
    const environment = String(body.environment ?? "dev");
    const env = await prisma.secretEnvironment.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        projectId,
        OR: [{ id: environment }, { slug: environment }],
      },
    });
    if (!env) throw new SecretsError("That environment is unavailable.");
    const result = await changeSecrets(actor, env.id, body.changes);
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    return apiError(error);
  }
}
