# Space Works machine API (`/api/v1`)

A small REST API for scripts and integrations. It runs the same `sw_*` tools
as the assistant and the MCP server, so permissions, validation, audit and
notifications are identical.

## Authentication and limits

- Create a token in **Settings → API tokens** and send it as
  `Authorization: Bearer sww_XXXXXXXXXXXX_<secret>`.
- Each endpoint needs a scope (below). A token acts for the admin who made it
  and stops working when revoked, expired, or when that admin leaves or is
  demoted.
- Rate limits per token: 600 reads and 60 writes per minute (`429` with
  `Retry-After`).
- Write bodies are JSON (`Content-Type: application/json`).

## Responses

```jsonc
// Lists
{ "data": [ ... ], "nextCursor": "clx…" | null }
// Single records and writes
{ "data": { ... } }
// Errors
{ "error": { "code": "FORBIDDEN", "message": "This token is missing the scope for this tool." } }
```

Pagination: pass `limit` (max 50–100 depending on the endpoint) and the
previous `nextCursor` as `cursor`. Status codes: `400` invalid input, `401`
missing or invalid token, `403` missing scope or role, `404` not found or
not visible, `429` rate limited.

## Endpoints

### Tasks

| Method and path | Scope | Notes |
| --- | --- | --- |
| `GET /api/v1/tasks` | `read:tasks` | Query: `project` (key), `assignee` (member id), `status` (`open` default, `done`, `all`), `dueWithinDays`, `query`, `limit` (≤50), `cursor`. |
| `POST /api/v1/tasks` | `write:tasks` | Body: `title`, `description?` (plain text), `project?` (key), `assignees?` (member ids), `priority?` (`NONE`, `LOW`, `MEDIUM`, `HIGH`, `URGENT`), `dueAt?` (ISO), `type?` (task type name on the project, e.g. `Bug`; case-insensitive). `201`. |
| `GET /api/v1/tasks/{ref}` | `read:tasks` | `ref` is `BOT-12` or `12`. Adds description, labels, subtasks and the latest comments. |
| `PATCH /api/v1/tasks/{ref}` | `write:tasks` | Body: `title?`, `status?` (`todo`, `in_progress`, `done`), `priority?`, `dueAt?` (ISO or `null`), `type?` (task type name), `assignees?` (full set; `me` allowed). |
| `POST /api/v1/tasks/{ref}/comments` | `write:tasks` | Body: `body` (plain text). `201`, `{ commentId, task }`. |
| `POST /api/v1/tasks/{ref}/assignees` | `write:tasks` | Body: `userIds` (`me` allowed), `mode?` (`add` default, `remove`, `set`). |
| `POST /api/v1/tasks/{ref}/claim` | `write:tasks` | Assigns the token's creator. No body. |
| `DELETE /api/v1/tasks/{ref}/claim` | `write:tasks` | Removes the token's creator from the task. |
| `POST /api/v1/tasks/{ref}/archive` | `write:tasks` | Body: `archived?` (default `true`; `false` restores). |
| `POST /api/v1/tasks/{ref}/move` | `write:tasks` | Body: `column?` (name) or `status?`, `position?` (`top`, `bottom`), `project?` (target key: moves the task to that project first). |
| `POST /api/v1/tasks/{ref}/transfer` | `write:tasks` | Body: `project` (target project key). Moves the task and its subtasks to that project at the bottom of the matching column; milestone links and the cycle are removed, the type is matched by name, assignees who can't see the target are dropped. The reference number stays. `400` for a subtask, a repeating template or the task's own project, `409` for an archived target project, `404` for an unknown or hidden project. |

Task DTOs include `type` (the type name, or the project's default; `null` without a project).

Task writes use the same services as the app: archived projects and archived tasks answer `409`, disabled members cannot be assigned (`400`), unknown or hidden tasks `404`, missing rights `403`. A date-only `dueAt` is a day in the workspace time zone.

Task DTO:

```json
{
  "ref": "BOT-12", "number": 12, "title": "Calibrate servo", "status": "to do", "column": "To do",
  "priority": "HIGH", "dueAt": "2026-11-02T12:30:00.000Z",
  "project": { "key": "BOT", "name": "Robot arm" },
  "assignees": [{ "id": "clx…", "name": "Meera Nair" }],
  "url": "/w/tinkerspace-kochi/projects/BOT/tasks/12"
}
```

### Projects

| Method and path | Scope | Notes |
| --- | --- | --- |
| `GET /api/v1/projects` | `read:tasks` | Query: `status` (`ACTIVE` default, `PAUSED`, `DONE`, `ARCHIVED`, `any`), `limit`, `cursor`. Returns key, name, description, status, owner, open task count. |

### Channels and messages

| Method and path | Scope | Notes |
| --- | --- | --- |
| `GET /api/v1/channels` | `read:chat` | Public channels only. |
| `GET /api/v1/channels/{channel}/messages` | `read:chat` | `channel` is a slug or id. Query: `limit` (≤50), `before` (ISO time). Newest first; the response has `nextBefore` instead of `nextCursor`. |
| `POST /api/v1/channels/{channel}/messages` | `write:chat` | Body: `{ "text": "…" }` (≤4,000 characters). Posted as the token's creator. `201`. |

### Docs

| Method and path | Scope | Notes |
| --- | --- | --- |
| `GET /api/v1/docs` | `read:docs` | Query: `query`, `parentId`, `limit`, `cursor`. Workspace-visible docs. |
| `GET /api/v1/docs/{docId}` | `read:docs` | Plain text (about 20,000 characters at most), children, url. |

### Members

| Method and path | Scope | Notes |
| --- | --- | --- |
| `GET /api/v1/members` | `read:members` | Query: `query` (name or skill), `limit`, `cursor`. Name, role, title, skills, short bio. Never emails or emergency contacts. |

## Example

```bash
curl -s "https://<your-instance>/api/v1/tasks?project=BOT&status=open" \
  -H "Authorization: Bearer $SPACE_WORKS_TOKEN"

curl -s -X POST "https://<your-instance>/api/v1/tasks" \
  -H "Authorization: Bearer $SPACE_WORKS_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Restock M3 screws","project":"BOT","priority":"LOW"}'
```
