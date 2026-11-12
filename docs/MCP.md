# Space Works MCP server

Space Works Workspace exposes the Space Works Assistant's tools over the
[Model Context Protocol](https://modelcontextprotocol.io) at:

```
POST https://<your-instance>/api/mcp
```

It is a stateless Streamable HTTP server (JSON responses, no sessions), so
any MCP client that speaks Streamable HTTP can use it. `GET` and `DELETE`
answer `405`.

## Authentication

Create a token in **Settings → API tokens** (workspace admins). Give it the
`mcp` scope plus the scopes for the tools you want:

| Scope | Tools |
| --- | --- |
| `read:tasks` | `sw_list_tasks`, `sw_get_task`, `sw_list_projects` |
| `write:tasks` | `sw_create_task`, `sw_update_task`, `sw_add_comment`, `sw_archive_task`, `sw_move_task`, `sw_assign_task`, `sw_claim_task` |
| `read:chat` | `sw_list_channels`, `sw_read_channel_messages` (public channels only, never DMs) |
| `write:chat` | `sw_send_channel_message` |
| `read:docs` | `sw_list_docs`, `sw_get_doc`, `sw_search_memory`, `sw_list_skills`, `sw_get_skill` |
| `write:docs` | `sw_create_doc`, `sw_remember`, `sw_forget` |
| `read:members` | `sw_list_members`, `sw_list_announcements` |
| `read:finance` | `sw_finance_summary` |
| any `read:*` | `sw_search_workspace` (results limited to the entity types your scopes cover) |

`tools/list` only returns the tools the token may call. Services
(`sw_list_monitors`, `sw_list_incidents`) and web search are only available
in the in-app assistant.

Send the token as a bearer token:

```
Authorization: Bearer sww_XXXXXXXXXXXX_<secret>
```

A token acts for the admin who created it, limited to its scopes. It stops
working when it is revoked, when it expires, or when that admin is removed,
suspended or no longer an admin. Every write is recorded in the audit log
with the token. Requests are rate limited per token (reads 600/min, writes
60/min); vault secrets, emergency contacts and direct messages are never
exposed.

### Task write tools

Task writes run through the same services as the app: archived projects
reject changes, disabled members cannot be assigned, new tasks go to the
bottom of the board column, dates are read in the workspace time zone
(a date-only `dueAt` is that calendar day; a date-time becomes the workspace
day it falls on), completing a task unblocks dependants, and task history
records `source` (`assistant`, `mcp` or `api`). Failures come back as tool
errors (`forbidden`, `not_found`, `conflict`, `invalid`).

| Tool | Input | Output |
| --- | --- | --- |
| `sw_create_task` | `title`, `description?`, `project?` (key), `assignees?` (`me` or ids), `priority?`, `dueAt?`, `type?` (type name on the project) | Task DTO |
| `sw_update_task` | `ref`, `title?`, `status?` (`todo`, `in_progress`, `done`), `priority?`, `dueAt?` (or `null`), `type?` (type name), `assignees?` (full set, `me` allowed) | Task DTO |
| `sw_add_comment` | `ref`, `body` (plain text, `<@memberId>` mentions) | `{ commentId, task }` |
| `sw_archive_task` | `ref`, `archived?` (default `true`; `false` restores) | Task DTO plus `archived` |
| `sw_move_task` | `ref`, `project?` (target key: moves the task and its subtasks to that project, then optionally to `column`/`status`), `column?` (name) or `status?`, `position?` (`top`, `bottom`; default `bottom`) | Task DTO (plus `warning` when still blocked) |
| `sw_assign_task` | `ref`, `userIds` (`me` allowed), `mode?` (`add` default, `remove`, `set`) | Task DTO |
| `sw_claim_task` | `ref`, `release?` (take yourself off) | Task DTO |

## Claude Code

```bash
claude mcp add --transport http space-works https://<your-instance>/api/mcp \
  --header "Authorization: Bearer sww_XXXXXXXXXXXX_<secret>"
```

Or in a project's `.mcp.json` (keep the token in an environment variable):

```json
{
  "mcpServers": {
    "space-works": {
      "type": "http",
      "url": "https://<your-instance>/api/mcp",
      "headers": { "Authorization": "Bearer ${SPACE_WORKS_TOKEN}" }
    }
  }
}
```

## Claude Desktop

Add a custom connector in **Settings → Connectors** with the URL
`https://<your-instance>/api/mcp` if your plan supports remote connectors with
custom headers. Otherwise bridge it through `mcp-remote` in
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "space-works": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-instance>/api/mcp", "--header", "Authorization:Bearer ${SPACE_WORKS_TOKEN}"],
      "env": { "SPACE_WORKS_TOKEN": "sww_XXXXXXXXXXXX_<secret>" }
    }
  }
}
```

## Trying it with curl

```bash
curl -s https://<your-instance>/api/mcp \
  -H "Authorization: Bearer $SPACE_WORKS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Errors: `401` for a missing or invalid token, `403` when the token lacks the
`mcp` scope, `429` when rate limited. A tool the token may not call returns a
normal result with `isError: true` and a short reason.
