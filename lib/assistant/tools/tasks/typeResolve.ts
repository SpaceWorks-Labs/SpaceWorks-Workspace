import "server-only";

import { ToolError } from "@/lib/assistant/tools/types";
import { listTaskTypesFor } from "@/lib/tasks/service/types";

/** A task type name (case-insensitive) on a project -> its id, with a helpful error listing the project's types. */
export async function resolveTypeId(workspaceId: string, projectId: string, name: string): Promise<string> {
  const types = await listTaskTypesFor(workspaceId, projectId);
  const match = types.find((type) => type.name.toLowerCase() === name.trim().toLowerCase());
  if (!match) throw new ToolError(`No task type "${name}" on this project. Types: ${types.map((type) => type.name).join(", ")}.`, "not_found");
  return match.id;
}
