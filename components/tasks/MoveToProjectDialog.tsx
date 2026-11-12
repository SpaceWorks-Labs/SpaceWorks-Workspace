"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listTransferTargetsAction, previewTransferAction, transferTaskAction } from "@/app/actions/taskTransfer";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/display";
import { Dropdown, Field } from "@/components/ui/field";
import type { TransferPreview } from "@/lib/tasks/service/transfer";
import type { TaskDetailDTO } from "@/lib/tasks/types";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "Move to project" (mounted only while open, so state starts fresh): pick a project, review what changes, confirm. Navigates to the task's new address. */
export function MoveToProjectDialog({ slug, task, open, onOpenChange }: { slug: string; task: TaskDetailDTO; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [targets, setTargets] = useState<Array<{ key: string; name: string }> | null>(null);
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listTransferTargetsAction(slug, task.project?.id ?? null).then((result) => {
      if (!cancelled) setTargets(result.ok ? (result.data ?? []) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, slug, task.project?.id]);

  const pick = async (key: string) => {
    const mine = ++request.current;
    setTarget(key);
    setPreview(null);
    setError(null);
    if (!key) return;
    let result;
    try {
      result = await previewTransferAction(slug, { taskId: task.id, targetProjectKey: key });
    } catch {
      result = { ok: false as const, error: "Couldn't load the preview. Try again." };
    }
    if (mine !== request.current) return;
    if (result.ok) setPreview(result.data ?? null);
    else setError(result.error);
  };

  const confirm = async () => {
    setBusy(true);
    let result;
    try {
      result = await transferTaskAction(slug, { taskId: task.id, targetProjectKey: target });
    } catch {
      result = { ok: false as const, error: "Couldn't move the task. Try again." };
    } finally {
      setBusy(false);
    }
    if (!result.ok || !result.data) {
      setError(result.ok ? "Couldn't move the task. Try again." : result.error);
      return;
    }
    showToast(`Moved to ${preview?.target.name ?? result.data.key} as ${result.data.reference}.`, "success");
    onOpenChange(false);
    router.push(result.data.url);
  };

  const dropped = preview ? preview.droppedAssigneeIds.map((id) => task.assignees.find((person) => person.id === id)?.name ?? "A member") : [];
  const notes = preview
    ? [
        preview.columnName ? `It goes to the bottom of ${preview.columnName}.` : "The new project has no columns yet.",
        preview.subtaskCount > 0 ? `${plural(preview.subtaskCount, "subtask")} move with it.` : null,
        preview.milestoneLinks > 0 ? `${plural(preview.milestoneLinks, "milestone link")} will be removed.` : null,
        preview.clearsCycle ? "It leaves its cycle." : null,
        dropped.length > 0 ? `${dropped.join(", ")} will be unassigned: they can't see ${preview.target.name}.` : null,
        !preview.typeKept ? `${preview.target.name} has no matching task type, so it uses the default type.` : null,
        `The number stays ${task.number}; old links keep working.`,
      ].filter((note): note is string => Boolean(note))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title="Move to project" description="The task keeps its number, comments and history." />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Project">
            <Dropdown value={target} disabled={targets === null} onChange={(event) => void pick(event.target.value)}>
              <option value="">{targets === null ? "Loading projects" : targets.length ? "Choose a project" : "No other open projects"}</option>
              {(targets ?? []).map((project) => (
                <option key={project.key} value={project.key}>
                  {project.name} ({project.key})
                </option>
              ))}
            </Dropdown>
          </Field>
          {error ? <Callout tone="warning" role="alert">{error}</Callout> : null}
          {notes.length > 0 ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-body-ui text-ink-secondary" aria-live="polite">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!preview} onClick={() => void confirm()}>
            Move task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
