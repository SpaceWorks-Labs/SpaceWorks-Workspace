"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteTaskPermanentlyAction, setTaskArchivedAction } from "@/app/actions/tasks";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout, EmptyState } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/format/datetime";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import type { ArchivedTaskDTO } from "@/lib/tasks/queries";

/** Archived tasks: restore (anyone who can edit the task) or delete for good (admins and the project owner, after typing the project key). */
export function ArchivedTasks({ slug, projectKey, tasks, timeZone, canDelete, projectArchived }: { slug: string; projectKey: string; tasks: ArchivedTaskDTO[]; timeZone: string; canDelete: boolean; projectArchived: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ArchivedTaskDTO | null>(null);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const restore = async (task: ArchivedTaskDTO) => {
    setBusy(task.id);
    try {
      const result = await setTaskArchivedAction(slug, { taskId: task.id, archived: false });
      if (!result.ok) return showToast(result.error, "error");
      showToast(`${taskReference(projectKey, task.number)} restored.`, "success");
      router.refresh();
    } catch {
      showToast("Couldn't restore the task. Try again.", "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(deleting.id);
    setError(null);
    try {
      const result = await deleteTaskPermanentlyAction(slug, { taskId: deleting.id, confirmKey: confirm });
      if (!result.ok) return setError(result.error);
      showToast(`${taskReference(projectKey, deleting.number)} deleted for good.`, "success");
      setDeleting(null);
      setConfirm("");
      router.refresh();
    } catch {
      setError("Couldn't delete the task. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  if (tasks.length === 0) return <EmptyState title="Nothing archived.">Archived tasks from this project show up here.</EmptyState>;

  return (
    <div className="flex flex-col gap-4">
      {projectArchived ? (
        <Callout tone="info" title="This project is archived.">
          Restore the project in its settings to restore or delete tasks.
        </Callout>
      ) : null}
      <Table label="Archived tasks">
        <THead>
          <tr>
            <TH>Task</TH>
            <TH>Archived</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {tasks.map((task) => {
            const reference = taskReference(projectKey, task.number);
            return (
              <TR key={task.id}>
                <TD className="min-w-[240px]">
                  <Link href={taskUrl(slug, projectKey, task.number)} className="font-medium text-ink underline-offset-4 hover:underline">
                    <span className="mr-2 text-caption font-semibold tabular-nums text-ink-muted">{reference}</span>
                    {task.title}
                  </Link>
                </TD>
                <TD className="whitespace-nowrap text-ink-secondary">
                  {formatDate(task.archivedAt, timeZone)}
                  {task.archivedBy ? ` by ${task.archivedBy}` : ""}
                </TD>
                <TD>
                  <div className="flex justify-end gap-2">
                    {task.canRestore ? (
                      <Button variant="secondary" size="sm" loading={busy === task.id && !deleting} onClick={() => void restore(task)} aria-label={`Restore ${reference}`}>
                        Restore
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        variant="quiet"
                        size="sm"
                        aria-label={`Delete ${reference} for good`}
                        onClick={() => {
                          setConfirm("");
                          setError(null);
                          setDeleting(task);
                        }}
                      >
                        Delete…
                      </Button>
                    ) : null}
                  </div>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent role="alertdialog">
          <DialogHeader
            title={deleting ? `Delete ${taskReference(projectKey, deleting.number)} for good?` : "Delete task?"}
            description="This removes the task, its subtasks, comments, history and files. It can't be undone."
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            <DialogBody className="flex flex-col gap-4">
              <Field label={`Type ${projectKey} to confirm`} error={error ?? undefined}>
                <Input value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" autoFocus spellCheck={false} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="dangerSolid" loading={busy === deleting?.id} disabled={confirm.trim().toUpperCase() !== projectKey.toUpperCase()}>
                Delete for good
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
