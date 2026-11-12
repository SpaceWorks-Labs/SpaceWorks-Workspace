"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArrowUpRight, Ellipsis } from "lucide-react";
import {
  loadTaskAction,
  setTaskArchivedAction,
  setTaskCompletedAction,
  updateTaskAction,
} from "@/app/actions/tasks";
import { useToast } from "@/components/feedback/ToastProvider";
import { useRealtime } from "@/components/realtime/useRealtime";
import { Button, IconButton } from "@/components/ui/button";
import { Callout, Chip } from "@/components/ui/display";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import type { TaskDetailDTO } from "@/lib/tasks/types";
import { BlockedChip, DueChip, TypeChip } from "./bits";
import { MoveToProjectDialog } from "./MoveToProjectDialog";
import { effectiveType } from "@/lib/tasks/taskTypes";
import { TaskDescription } from "./TaskDescription";
import { TaskPlan } from "@/components/projects/TaskPlan";
import { TaskAttachments } from "./TaskAttachments";
import { TaskComments } from "./TaskComments";
import { TaskDependencies } from "./TaskDependencies";
import { TaskHistory } from "./TaskHistory";
import { TaskSubtasks } from "./TaskSubtasks";
import { TitleEditor } from "./TaskTitleEditor";
import { TaskProperties } from "./TaskProperties";
import { useDetailAssignment } from "./useAssignment";
import { useTaskRunner } from "./useTaskRunner";

/**
 * Everything about one task: title, status, priority, people, labels, due
 * date, repeat, description, subtasks, dependencies, attachments, comments
 * and history. Used by the full task page and the board's side panel.
 * Refetches through `loadTaskAction` after each change and when someone
 * else changes the task (realtime `task:<id>`).
 */
export function TaskDetail({ slug, initial, variant, onChanged }: { slug: string; initial: TaskDetailDTO; variant: "page" | "drawer"; onChanged?: () => void }) {
  const [task, setTask] = useState(initial);
  const [moving, setMoving] = useState(false);
  const { showToast } = useToast();
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setTask(initial);
  }

  const reload = useCallback(async () => {
    const next = await loadTaskAction(slug, task.number);
    if (next) setTask(next);
    onChanged?.();
  }, [slug, task.number, onChanged]);
  const run = useTaskRunner(reload);
  const assignment = useDetailAssignment(slug, task, setTask, reload, variant === "drawer");

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime(
    slug,
    useCallback(
      (event) => {
        if (event.channel !== `task:${task.id}` || event.actorId === task.viewerId) return;
        if (pending.current) clearTimeout(pending.current);
        pending.current = setTimeout(() => {
          void loadTaskAction(slug, task.number).then((next) => next && setTask(next));
        }, 300);
      },
      [slug, task.id, task.number, task.viewerId],
    ),
  );

  const canEdit = task.permissions.canEdit && !task.archivedAt;
  const reference = taskReference(task.project?.key, task.number);
  const column = task.columns.find((item) => item.id === task.columnId) ?? null;
  const isPage = variant === "page";
  const url = taskUrl(slug, task.project?.key, task.number);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).toString());
      showToast(`Link to ${reference} copied.`, "success");
    } catch {
      showToast("Couldn't copy the link. Copy it from the address bar instead.", "error");
    }
  };

  const properties = <TaskProperties slug={slug} task={task} canEdit={canEdit} run={run} />;

  return (
    <article className="flex flex-col gap-6" aria-label={`${reference} ${task.title}`}>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
          {task.project ? (
            <Link href={`/w/${slug}/projects/${task.project.key}`} className="font-semibold text-ink-secondary underline-offset-4 hover:underline">
              {task.project.name}
            </Link>
          ) : (
            <Link href={`/w/${slug}/my-tasks`} className="font-semibold text-ink-secondary underline-offset-4 hover:underline">
              My tasks
            </Link>
          )}
          {task.parent ? (
            <>
              <span aria-hidden>/</span>
              <Link href={taskUrl(slug, task.parent.projectKey, task.parent.number)} className="font-semibold text-ink-secondary underline-offset-4 hover:underline">
                {taskReference(task.parent.projectKey, task.parent.number)} {task.parent.title}
              </Link>
            </>
          ) : null}
          <span aria-hidden>/</span>
          <span className="font-semibold tabular-nums">{reference}</span>
        </div>
        <TitleEditor
          value={task.title}
          as={isPage ? "h1" : "h2"}
          editable={canEdit}
          onSave={async (title) => {
            try {
              const result = await updateTaskAction(slug, { taskId: task.id, title, expectedTitle: task.title });
              if (result.ok) {
                await reload();
                return true;
              }
              if (result.fieldErrors?.conflict) return "conflict";
              showToast(result.error, "error");
            } catch {
              showToast("Couldn't save. Check your connection and try again.", "error");
            }
            return false;
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          {task.completedAt ? (
            <Chip tone="success" icon={null}>
              Done
            </Chip>
          ) : column ? (
            <Chip tone={column.category === "IN_PROGRESS" ? "info" : "neutral"}>{column.name}</Chip>
          ) : (
            <Chip tone="neutral">Open</Chip>
          )}
          {(Boolean(task.blockerReason) || task.blockedBy.some((item) => !item.completedAt && !item.archivedAt)) ? <BlockedChip size="md" /> : null}
          {task.archivedAt ? <Chip tone="outline">Archived</Chip> : null}
          <TypeChip type={effectiveType(task.taskTypes, task.typeId)} size="md" />
          <DueChip dueAt={task.dueAt} completedAt={task.completedAt} timeZone={task.timeZone} size="md" />
          <div className="ml-auto flex items-center gap-1.5">
            {assignment.mode ? (
              <Button variant="secondary" size="sm" onClick={assignment.toggle} title="Shortcut: I">
                {assignment.mode === "claim" ? "Assign to me" : "Unassign me"}
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                variant={task.completedAt ? "secondary" : "primary"}
                size="sm"
                startIcon={task.completedAt ? undefined : <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">✓</span>}
                onClick={() => void run(() => setTaskCompletedAction(slug, { taskId: task.id, completed: !task.completedAt }), task.completedAt ? `${reference} reopened.` : `${reference} done. Nice work.`)}
              >
                {task.completedAt ? "Reopen" : "Mark done"}
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
              Copy link
            </Button>
            {variant === "drawer" ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={url}>
                  Open page
                  <ArrowUpRight aria-hidden className="size-4" />
                </Link>
              </Button>
            ) : null}
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="More task actions" variant="secondary">
                  <Ellipsis />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                {canEdit && !task.parent ? (
                  <MenuItem icon={null} onSelect={() => setMoving(true)}>
                    Move to project…
                  </MenuItem>
                ) : null}
                {task.permissions.canEdit ? (
                  task.archivedAt ? (
                    <MenuItem icon={null} onSelect={() => void run(() => setTaskArchivedAction(slug, { taskId: task.id, archived: false }), `${reference} restored.`)}>
                      Restore task
                    </MenuItem>
                  ) : (
                    <MenuItem icon={<Archive />} onSelect={() => void run(() => setTaskArchivedAction(slug, { taskId: task.id, archived: true }), `${reference} archived. Restore it from this page any time.`)}>
                      Archive task
                    </MenuItem>
                  )
                ) : null}
              </MenuContent>
            </Menu>
          </div>
        </div>
      </header>

      {task.archivedAt ? (
        <Callout tone="info" title="This task is archived." action={task.permissions.canEdit ? <Button size="sm" variant="secondary" onClick={() => void run(() => setTaskArchivedAction(slug, { taskId: task.id, archived: false }), `${reference} restored.`)}>Restore</Button> : null}>
          It&apos;s hidden from the board and My tasks.
        </Callout>
      ) : null}
      {task.project?.status === "ARCHIVED" ? <Callout tone="info" title="This project is archived.">Tasks stay readable. Restore the project to change them.</Callout> : null}

      <div className={cn("grid gap-8", isPage && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
        {isPage ? (
          <aside aria-label="Details" className="lg:order-2">
            <div className="rounded-xl border border-line bg-panel px-4 py-1 lg:sticky lg:top-6">{properties}</div>
          </aside>
        ) : null}
        <div className={cn("flex min-w-0 flex-col gap-8", isPage && "lg:order-1")}>
          {!isPage ? <section aria-label="Details" className="rounded-xl border border-line bg-panel px-4 py-1">{properties}</section> : null}
          <TaskDescription slug={slug} task={task} canEdit={canEdit} reload={reload} />
          <TaskPlan key={`${task.id}-${task.updatedAt}`} slug={slug} task={task} reload={reload} />
          <TaskSubtasks slug={slug} task={task} run={run} />
          <TaskDependencies slug={slug} task={task} run={run} />
          <TaskAttachments slug={slug} task={task} run={run} />
          <TaskComments slug={slug} task={task} run={run} mentionable={task.members} />
          <TaskHistory task={task} />
        </div>
      </div>
      {moving ? <MoveToProjectDialog slug={slug} task={task} open onOpenChange={setMoving} /> : null}
    </article>
  );
}
