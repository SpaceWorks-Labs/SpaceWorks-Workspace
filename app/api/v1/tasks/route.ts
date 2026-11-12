import { listEndpoint, writeEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/tasks (read:tasks). Query: project, assignee, creator (each "me", a member id or an email), includeArchived, status, dueWithinDays, query, limit, cursor. */
export function GET(request: Request) {
  return listEndpoint(request, "sw_list_tasks", "tasks", ["limit", "dueWithinDays"]);
}

/** POST /api/v1/tasks (write:tasks). Body: { title, description?, project?, assignees?, priority?, dueAt? }. */
export function POST(request: Request) {
  return writeEndpoint(request, "sw_create_task", {}, 201);
}
