# Tasks and projects

Projects, kanban boards, task detail, My tasks, recurring tasks and
dependencies. Ownership row "1. tasks" in [ROADMAP-BUILD.md](../ROADMAP-BUILD.md).

## Routes

| Route | Who | What |
| --- | --- | --- |
| `/w/[slug]/projects` | GUEST+ | Project cards with progress, owner, team; status tabs (`?status=open\|ACTIVE\|PAUSED\|DONE\|ARCHIVED\|all`); "New project" for members |
| `/w/[slug]/projects/[key]` | GUEST+ | Board (default) or list (`?view=list`), filters in the URL, side panel (`?task=12`) |
| `/w/[slug]/projects/[key]/overview` | GUEST+ | Stats, columns, upcoming due, workload, recent activity |
| `/w/[slug]/projects/[key]/settings` | ADMIN or project owner | Details, owner, team, status, dates, task types; archive / restore |
| `/w/[slug]/projects/[key]/[number]` | GUEST+ | Full task page (old project keys redirect to the current one) |
| `/w/[slug]/projects/[key]/tasks/[number]` | GUEST+ | Alias → canonical task page |
| `/w/[slug]/t/[ref]` | GUEST+ | Short link (`BOT-12`, `12`); tasks without a project live here |
| `/w/[slug]/my-tasks` | MEMBER+ | Assigned to me, grouped overdue / today / this week / later / no date, quick complete with undo |

Board URL state: `assignee=me,none,<userId>`, `label=<id>`, `priority=URGENT,HIGH`,
`due=overdue|today|week|scheduled|none`, `q=`, `view=list`, `sort=manual|due|priority|number|updated|title`,
`group=column|assignee|priority|label|due|none`, `task=<number>`.

## Code

- `lib/tasks/` — pure, client-safe: `position.ts` (fractional ordering, rebalance), `recurrence.ts`
  (RRULE subset, next occurrence in the workspace zone, presets, assignee rotation), `dependencies.ts`
  (cycle check), `filters.ts`, `due.ts` (buckets, 9 AM reminders), `mentions.ts` (`<@userId>` tokens),
  `links.ts`, `localDate.ts`, `activityText.ts`, `schemas.ts` (Zod), `types.ts` (DTOs).
  Server-only: `access.ts` (visibility, roles, realtime audience), `service.ts` (task mutations),
  `recurrenceService.ts` (repeat control + generator), `reminders.ts`, `queries.ts`, `search.ts`,
  `sanitize.ts`, `realtime.ts`.
- `lib/projects/` — `keys.ts` (key rules, column templates), `service.ts` (projects and columns),
  `queries.ts` (list, overview, teams).
- `app/actions/projects.ts`, `app/actions/tasks.ts` — Server Actions plus loaders the board, task
  panel and My tasks use to refetch.
- `components/tasks/`, `components/projects/` — board, cards (drag and drop + Move menu), list,
  filter bar, task detail (tiptap description, subtasks, dependencies, attachments, comments with
  mentions, repeat control, history), drawer, My tasks; project dialogs, tabs and settings.
- `lib/scheduled/tasks.ts` — recurring instances and due/overdue reminders, once a minute.

## Rules

- Visibility: workspace projects are visible to all members; projects of a PRIVATE team only to its
  members and admins (`lib/teamAccess`). Tasks follow their project. Tasks without a project are
  visible to members, and to guests only when they created or were assigned them.
- GUEST reads and comments. MEMBER creates and edits tasks and projects (becoming the owner).
  ADMIN or the project owner edits the project and its columns and archives it. Archived projects
  are read-only (comments stay open). Only members (not guests) can be assigned.
- Task numbers: `nextWorkspaceSequence(tx, workspaceId, "task")`, shown as `KEY-12` (`#12` without
  a project).
- Ordering: float `position` per column; moves send the task above (`afterTaskId`), the server
  places between neighbours and renumbers the column when a gap runs out.
- Done columns (`ColumnCategory.DONE`) set `completedAt`; moving out clears it. Completing a task
  notifies (`task.status_changed`) and unblocks dependants whose last open blocker closed
  (`task.unblocked`, once per pair).
- Dependencies (`BLOCKS`) are acyclic: inserts take a per-workspace advisory lock and run a DFS.
- Recurrence: the task where "Repeat" is set is the template. ON_SCHEDULE creates a copy at 09:00
  local on each matching day (due `dueOffsetDays` later); after downtime it creates one and skips
  ahead. ON_COMPLETION creates the next copy (due the next matching day after the finished one's due
  day) once the current one is done. Exactly once across replicas: conditional claim on `nextRunAt`
  plus `TaskOccurrence` unique key. Archiving the template stops the repeat.
- Reminders: `task.due` at 09:00 on the due day, `task.overdue` at 09:00 the day after (for a week),
  to assignees, once per task and due date (advisory lock + dedupe key).
- Assignment: `TaskAssignee` rows (0..20 per task, `assignedById` records who assigned; the person themselves
  when they claimed it). `lib/tasks/service/assignments.ts` (`setAssignees`, `assignTask`, `unassignTask`,
  `claimTask`, `unclaimTask`) locks the task row (`SELECT ... FOR UPDATE`), reads the current set inside the
  transaction, applies only the real difference and is idempotent (no history or notification for a no-op).
  Actions: `app/actions/taskAssign.ts`. History `assigned` / `unassigned` carries `{ userIds, by }` (`claimed: true`
  for "Assign to me") plus `source` (`web|assistant|mcp|api`, default web) and optional `client`; the history
  text adds "via Assistant", "via MCP · client" or "via API" off the web.
- Restricted edits: `Project.restrictTaskEdits` (project settings, `canManageProject` only). Pure rules in
  `lib/tasks/capabilities.ts` (shared by services and DTOs): edit = MEMBER+ normally, or the task creator, a
  current assignee, the project owner or an ADMIN/OWNER when restricted; claim = MEMBER+ and, when restricted,
  only while the task has no assignee; unclaim = current assignee; contribute (attachments) = MEMBER+. Comments
  stay open to everyone who can see the task. `loadEditableTask(actor, id, { action })` is the one gate
  (also `saveTaskPlan`, recurrence, subtasks as an edit on the parent). Board, detail and My tasks DTOs return per-task
  `canEdit`, `canClaim`, `isAssignedToMe` so the UI never offers a rejected action. UI: "Assign to me" /
  "Unassign me" (task panel, card hover button, `i` shortcut in the drawer) with optimistic update and Undo toast.
- Notifications (all through `dispatch`): `task.assigned`, `task.unassigned` (removed people, not the actor),
  `task.status_changed`, `task.commented`
  (assignees + creator), `mention` (comments; edits notify newly mentioned people only),
  `task.unblocked`, `task.due`, `task.overdue`. Recipients are filtered to people who can see the task.
- Realtime: `task.created|task.changed|task.removed|board.changed` on `project:<id>`,
  `task.changed|comment.changed` on `task:<id>`; ids only, private-team projects use `audience`.
- Search: `SearchDocument` rows for tasks (`KEY-12 title` + plain-text description) and projects;
  removed on archive.
- Descriptions are sanitised server-side (`sanitize-html` allow-list matching the editor).
- Audit: `project.*`, `task.created|archived|restored|comment_deleted|dependency_added|dependency_removed|recurrence_set|recurrence_stopped|attachment_removed`.

## Demo data

`node --env-file-if-exists=.env scripts/seed/tasks.mjs` (after `npm run db:seed:demo`) adds the OPS
"Space upkeep" project with a weekly rotating repeat, subtasks, a dependency and a mention.

## Known gaps

- Attachments are downloadable by any active member through `/api/files/[id]` (shared core), even
  for tasks in a private team's project.
- The home dashboard (platform-shell) lists tasks without private-team filtering.

## My Tasks tabs

`/w/<slug>/my-tasks?tab=assigned|assigned-by-me|team|created` (default `assigned`; the tab switches client-side and
updates `?tab=`; accessible tablist from `components/ui/tabs`). All tabs share the visibility rules
(`visibleTaskWhere`), skip archived tasks and archived projects, show open tasks plus those finished in the last
12 hours, order by due date, priority, newest, cap at 500, and group by due bucket. Queries live in
`lib/tasks/queries/my-tasks.ts` (`listMyTasks(actor, now, tab)`); rows carry `assignees` and the per-task
`canEdit` / `canClaim` / `isAssignedToMe`.

- Assigned by me: a `TaskAssignee` row with `assignedById = me` and another person as assignee; rows that predate
  `assignedById` (null) count when I created the task. Each row shows who it is assigned to.
- My team: open tasks assigned to my direct reports. `MemberProfile.managerId` is the manager's **user id**;
  reports must have an ACTIVE membership and an enabled user (`directReportIds`). The tab is hidden without reports
  (`?tab=team` then falls back to Assigned to me).
- Created by me: tasks where I am the creator.
- Quick add (`MyTasksQuickAdd`): title, active project picker and "Assign to me" (on by default); guests get none.

## List view: inline + bulk edit

- Inline cells (`ListCells.tsx`, `useListEdits.ts`): status (column), priority, assignees (multi-select, "Me" first)
  and due date edit in place, optimistically, with rollback plus the server's message on a refusal and an Undo
  toast on success. Cells are read-only with a hint when the viewer cannot edit the task; "Assign to me" stays
  available when `canClaim`. The title button alone opens the drawer.
- Selection (`useListSelection.ts`, pure rules in `lib/tasks/selection.ts`): checkbox column for tasks the viewer can
  edit or claim, a tri-state select-all per group, Shift-click ranges in visible order, at most 50 ("Select up
  to 50 tasks"), Escape clears.
- Bulk bar (`BulkBar.tsx`): move to column, priority, add/remove assignee, assign to me, archive (two-step confirm).
  `bulkUpdateTasksAction` (`app/actions/taskBulk.ts`) -> `lib/tasks/service/bulk.ts` loops the single-task services
  per id (so `restrictTaskEdits`, archive and visibility rules apply per task) and returns
  `{ taskId, ref, ok, error? }` per task. A result toast reads "Updated 12 tasks - 2 failed" and the failures are
  listed with their reference and reason.
- Rate limit: bulk calls spend one unit per task of the `bulk` bucket (200 per minute, `isActionRateLimited(bucket,
  subject, cost)`), so 50 operations cannot pass as one `action` unit.
- Remembered view: `useRememberedTaskQuery` (called from `FilterBar`) stores `{ view, filters, sort, group }` in
  `localStorage` under `sww.tasks.view.<workspaceSlug>.<projectKey>`. It restores only when the URL has no
  view/filter/sort/group parameter, and every storage access is wrapped in try/catch.
- Wiring: `ProjectBoard` should pass `slug`, `viewerId` and `onChanged={reload}` to `ListView`; without them the
  route slug is used, the "Me" shortcuts are hidden and fresh data arrives through the realtime refetch.

## Task types

Per-project types (`ProjectTaskType`: name, tone, icon, default flag, position; unique per project name).
`Task.typeId` is optional; `null` shows as the project's default type.

- Defaults (Task, Bug, Feature) are created lazily by `ensureDefaultTaskTypes` the first time a project's
  types are read (board, task detail, settings, MCP): only when the project has none, `createMany skipDuplicates`.
- `lib/tasks/service/types.ts`: list, create, update (name, tone, icon), set default, reorder, delete.
  Managing needs `canManageProject`. Delete is refused for the default type and for a type still used
  ("Move N tasks to another type first."). Max 20 types per project.
- A task's type is set through `createTask` / `updateTask` (`typeId`; `null` = project default). The type must
  belong to the task's project. New tasks store the default type's id. History kind `type_changed { from, to }` (names).
- UI: project settings "Task types", a type chip on cards and the task header, a "Type" picker in task properties.
  Icons map to approved lucide glyphs in `components/tasks/typeIcons.ts` (see DESIGN.md §3.2).
- Board and detail DTOs carry `taskTypes` and the effective `typeId` (default resolved), so filters and list
  columns can use `typeId` directly. MCP/REST: `type` (name, case-insensitive) on create and update; task DTOs return `type`.

## Moving tasks between projects

`transferTask(actor, { taskId, targetProjectKey })` in `lib/tasks/service/transfer.ts` (plan in `transferPlan.ts`,
`previewTransfer` feeds the confirmation dialog). One transaction, task row locked.

- Rights: the edit gate on the source task, and a visible, non-archived target (MEMBER+ may add tasks there).
  Refused: subtasks ("Move the parent task instead"), tasks that are the template of a repeat rule, the same project.
- Milestone links are deleted first (composite foreign keys), `cycleId` is cleared, the column is the target's
  first column of the same category (else the first To do column), the card goes to the bottom, `completedAt`
  follows the target category, the type is matched by name (else the default), assignees who cannot see the target
  are dropped. Subtasks move too (same type and assignee rules, no column).
- The number is kept, so references still resolve: `/projects/OLD/12` and `/t/OLD-12` redirect to the current
  key (`canonicalTaskRedirect`). History `transferred { from, to, droppedAssignees }`, activity feed, audit
  `task.transferred`, search reindexed, realtime on both project channels (`task.removed` old, `task.created` new).
  No notification is sent (there is no existing "moved project" event).
- UI: "Move to project…" in the task's overflow menu; navigates to the new address. MCP `sw_move_task` takes
  `project`; REST `POST /api/v1/tasks/{ref}/transfer`.

## Board interactions (drag, keyboard, touch)

`components/tasks/board/` (columns, sortable cards, `useBoardDnd`) on @dnd-kit; pure rules in `lib/tasks/boardMoves.ts`.

- Pointer drag after 4px, touch drag after a 200ms press (6px tolerance), keyboard: focus a card, Space picks it up,
  arrows move it between and within columns, Space or Enter drops, Escape cancels. Enter on a card opens it.
- Collision: pointer-within first (empty columns accept drops), closest corners for the keyboard. The dragged card
  floats in a `DragOverlay` (token shadow, motion tokens; no drop animation with reduced motion), the source is dimmed.
- Moves are optimistic and roll back with the server's message on error. Realtime refetches wait until a drag ends.
- Screen readers hear "Picked up BOT-12 Title.", "BOT-12 moved to In progress, position 3 of 7.", "Dropped BOT-12 in
  In progress.", "Move cancelled."
- Cards the viewer cannot edit (restricted project) are not draggable and show a "Locked" hint on hover or focus.
- Each card's "Move" menu (column list, up, down, top, bottom of column) is the touch and screen-reader alternative.
- Column headers show a category dot, the name and the count. Quick add stays open after Enter, Shift+Enter adds and
  opens the task, Escape closes and returns focus. `c` opens quick add in the first column while focus is on the board.
- Collapse: each column header has a "Collapse <name>" / "Expand <name>" button (`aria-expanded`). A collapsed column is a
  narrow strip with the name and count that remains the column's droppable (cards dropped on it go to the end); the choice is
  remembered per column in `localStorage` (`sw:collapse:board`). Quick add (`c`) opens a collapsed column for that moment.

## List and My Tasks group collapse

List view group headers (when grouped) and My Tasks due buckets toggle with the shared `CollapsibleSection`
(see `docs/DESIGN.md` 4.16); the count stays visible when closed. List groups are remembered per project, group-by and
group; collapsing a group deselects its rows and its rows are not selectable while closed. My Tasks: "No due date"
starts closed, the rest open.
